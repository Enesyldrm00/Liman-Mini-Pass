# 0018 — Veritabanı katmanı: ayrı paket, text + CHECK, node-postgres

- Durum: Kabul edildi
- Tarih: 2026-11-25
- Faz: 0

## Bağlam

0.4'te Bölüm 7'deki şema Drizzle ile yazıldı. ROADMAP şu üç soruyu açık bırakıyordu:

1. Şema hangi pakette duracak? API ve worker aynı tablolara erişir; panel (web) ise veritabanına hiç dokunmaz ama `@liman/shared` paketini kullanır.
2. Durum alanları (`builds.status`, `deployments.status` vb.) Postgres `enum` mu olacak, `text` mi?
3. Hangi Postgres sürücüsü kullanılacak? Faz 1'deki deploy kilidi (advisory lock) için bir bağlantıyı bir süre elde tutabilmek gerekiyor.

Bunlara ek olarak bir paket ilk kez başka bir workspace paketini (`@liman/db` → `@liman/shared`) içe aktarıyor. Bu yüzden geliştirmede ve testte paketlerin derlenmeden kullanılabilmesi de çözülmesi gereken bir konu.

## Karar

- **Yeni paket: `packages/db` (`@liman/db`).** İçinde şema, bağlantı (`createDb`), migration'lar ve migration çalıştırıcısı var. API ve worker bu paketi kullanır, panel kullanmaz.
- **Durum alanları `text` + `CHECK`.** İzin verilen değerler `@liman/shared` içindeki sabit listelerden (`BUILD_STATUSES` vb.) üretilir. Böylece TypeScript tipi ile veritabanı kısıtı aynı kaynaktan gelir. Kısmi index'lerin koşulları da aynı listelerden üretilir (`ACTIVE_BUILD_STATUSES`).
- **Sürücü: `pg` (node-postgres).** Bağlantı havuzu (`Pool`) kullanılır. Advisory lock için havuzdan tek bir bağlantı alınıp kilit süresince tutulabilir.
- **Migration'lar:** `drizzle-kit generate` ile SQL olarak üretilip repoya girer. Bu migration'ları drizzle-orm'un programatik migrator'ı uygular (`pnpm --filter @liman/db migrate`). drizzle-kit yalnızca geliştirme bağımlılığıdır.
- **Kimlikler:** `gen_random_uuid()` ile veritabanında üretilir.
- **Silme davranışı:**
  - Uygulamaya bağlı satırlar (env, build, log, deployment) ve oturumlar cascade ile silinir.
  - `owner_id` ve `installation_ref` RESTRICT'tir. Bir installation kaldırıldığında uygulamalara ne olacağına Faz 1.2'de (webhook senkronu) karar verilecek.
- **Kaynaktan çözümleme:** Workspace paketleri `exports` içinde `liman-source` adlı özel bir koşulla kaynak dosyalarını (`src/index.ts`) da gösterir. Bu koşulu kullananlar:
  - typecheck (`customConditions`),
  - Vitest (`resolve.conditions`),
  - `tsx --conditions=liman-source`.

  Build (`tsconfig.build.json`) ve üretim ise `dist/` kullanır.

## Elenen alternatifler

- **Şemayı `packages/shared` içine koymak:** Panel de bu paketi kullandığı için `pg` ve drizzle panelin bağımlılıklarına girerdi.
- **Şemayı `apps/api/src/db` içine koymak:** Worker'ın API uygulamasına bağımlı olması gerekirdi. İki uygulama birbirinden bağımsız olmalı.
- **Postgres `enum`:** Bir enum'a değer eklemek kolaydır, ama değer çıkarmak veya yeniden adlandırmak tip değiştirmeyi gerektirir. Ayrıca `ALTER TYPE ... ADD VALUE` ile eklenen değer, aynı transaction içinde kullanılamaz. `CHECK` kısıtı ise tek bir migration'da kaldırılıp yeniden eklenebilir.
- **`postgres` (postgres.js) sürücüsü:** Hızlı ve modern bir sürücü. Ancak Testcontainers ve drizzle örneklerinin çoğu `pg` ile yazılmış. Ayrıca bağlantıyı elde tutma modeli (`pool.connect()` → `release()`) advisory lock için daha açık.
- **`uuidv7()`:** Postgres 18'de yerleşik geliyor ve zamana göre sıralı olduğu için index'te daha verimli. Ancak ROADMAP "PostgreSQL 17+" diyor; 17'de bu fonksiyon yok.
- **Her test ve geliştirme öncesinde `pnpm build`:** Unutulması kolay ve geri bildirim döngüsünü yavaşlatıyor.

## Sonuçlar

- "Aktif deployment en fazla bir tane" kuralını kısmi unique index (`deployments_one_active_per_app`) garanti eder. Testcontainers ile yazılan entegrasyon testi bunu gerçek Postgres üzerinde doğrular.
- Yeni bir durum değeri eklemenin adımları:
  1. Değer `@liman/shared` içindeki sabite eklenir.
  2. `pnpm --filter @liman/db generate` çalıştırılır.
  3. Üretilen yeni migration CHECK kısıtını günceller.
- `drizzle-kit generate`, `@liman/shared` paketini `dist/` üzerinden okur. Bu yüzden `generate` betiği önce shared'i derler.
- `CHECK` ve index koşullarındaki değerler SQL'e literal olarak yazılır, çünkü bu yerlerde bind parametresi kullanılamaz. Bu yalnızca koddaki sabitler için güvenlidir; kullanıcı girdisi buraya asla gelmez.
- Entegrasyon testleri Docker gerektirir. CI'da (0.10) GitHub Actions runner'ında Docker hazır gelir.
