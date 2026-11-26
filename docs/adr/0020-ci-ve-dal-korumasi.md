# 0020 — CI ve main dal koruması

- Durum: Kabul edildi
- Tarih: 2026-11-27
- Faz: 0

## Bağlam

0.10'a kadar PR'lar lokal kontrollerle (lint, typecheck, test, format:check) merge edildi. ROADMAP 0.10 iki şey istiyor: her PR'da ve main'de kurulum (pnpm önbellekli), lint, typecheck, birim testler ve build; ayrıca main'de PR zorunluluğu ve CI yeşil olmadan merge olmaması. Bölüm 13'teki "Bağımlılık tedarik zinciri" satırı da Faz 0 için "kilitli lockfile, CI'da bağımlılık denetimi" diyor.

Açık kalan üç soru vardı:

1. Testlerin hepsi mi çalışacak, yalnızca birim testleri mi? `pnpm test` Testcontainers ile Postgres ve Redis başlatan entegrasyon testlerini de içeriyor.
2. Bağımlılık denetimi neyi tarayacak ve ne zaman CI'ı kıracak?
3. Üçüncü taraf action'lar nasıl sabitlenecek?

## Karar

- **Tek workflow (`.github/workflows/ci.yml`), iki job.** `pull_request` ve main'e `push` ile tetikleniyor; ayrıca haftada bir (pazartesi) yalnızca `audit` çalışıyor, böylece yeni çıkan bir açık sonraki PR'ı beklemeden görünüyor. Token'ın yetkisi `contents: read`; checkout kimlik bilgisini diske bırakmıyor (`persist-credentials: false`). PR'da yeni bir push eski çalışmayı iptal ediyor. main'de ise her commit kendi concurrency grubunda (`github.sha`) çalışıyor ve hiç iptal edilmiyor: art arda iki merge olsa da her main commit'i bir sonuç alıyor. Faz etiketi ancak CI'ı yeşil bir commit'e atılıyor, ileride deploy da yarıda kesilmiyor.
  - `check`: `pnpm install --frozen-lockfile`, `lint`, `typecheck`, `format:check`, `test`, `build`. Node sürümü `.nvmrc`'den, pnpm sürümü `packageManager` alanından geliyor; pnpm deposu `setup-node` ile önbelleğe alınıyor.
  - `audit`: `pnpm audit --prod --audit-level high`.
- **Testlerin hepsi CI'da.** GitHub'ın Ubuntu runner'larında Docker hazır, Testcontainers ek bir ayar istemiyor. Böylece Bölüm 14'teki entegrasyon senaryoları (Origin 403, kısmi unique index, deadlock sıralaması…) her PR'da korunuyor.
- **Denetim yalnızca üretim bağımlılıklarında, high ve critical'da kırmızı.** Sunucuda ve panelde çalışan kod bunlar. Test ve build araçlarındaki açıklar PR'ları sürekli bloklamasın diye dev bağımlılıkları kapsam dışı.
- **Action'lar commit SHA'sıyla sabitli**, yanında sürüm yorumu var (ör. `# v7.0.1`). Bir tag sonradan başka bir commit'e taşınsa da CI'da çalışan kod değişmiyor.
- **Repo Actions ayarları:** yalnızca GitHub'ın kendi action'ları ve `pnpm/action-setup` çalışabiliyor ve SHA ile sabitlenmeleri zorunlu. Varsayılan `GITHUB_TOKEN` salt okunur, Actions PR onaylayamıyor. Fork'tan gelen her PR'ın çalışması Enes onaylayınca başlıyor (yalnızca ilk kez katkı verenler değil): public repoda yabancı kod Docker'lı runner'da onaysız çalışmıyor.
- **main dal koruması (repo ayarı):**
  - PR zorunlu; onay sayısı 0, çünkü tek geliştirici var ve onay şartı her PR'ı kilitlerdi.
  - `check` ve `audit` yeşil olmadan merge yok. Check'ler GitHub Actions uygulamasına (app id 15368) bağlı; başka bir GitHub App aynı adla sahte sonuç yazamıyor.
  - Strict: `pull_request` çalışması zaten PR'ın main ile birleşmiş hâlini (`refs/pull/N/merge`) test ediyor. Strict'in kattığı şey, çalışma sırasında ya da sonrasında main ilerlerse PR'ın yeni main'e göre yeniden test edilmesini zorlamak.
  - Kural adminlere de uygulanıyor; force push ve dal silme kapalı.

## Elenen alternatifler

- **Yalnızca birim testleri.** Daha hızlı, ama entegrasyon testlerini ayırmak için yeni bir betik ya da etiket gerekirdi. DB ve Redis'e dokunan hatalar da (en değerli testler) CI'dan kaçardı.
- **Bütün bağımlılıkları denetlemek.** Dev araçlarındaki, çoğu bizi etkilemeyen açıklar yüzünden PR'lar sık bloklanırdı.
- **Denetimi yalnızca uyarı olarak çalıştırmak.** Hiç bloklamazdı ve Bölüm 13'teki maddeyi tam karşılamazdı.
- **Tag ile sabitleme (`@v7`).** Okuması kolay, ama taşınan ya da ele geçirilen bir tag'e karşı koruması yok.
- **Onay şartı (1 review).** Tek geliştiricide her PR'ı kilitler; inceleme yerine `liman-reviewer` ve `security-auditor` agent'ları çalışıyor.
- **Adminleri muaf tutmak.** Acil durumda işe yarardı, ama "CI yeşil olmadan merge yok" kuralını delerdi.

## Sonuçlar

- CI süresinin çoğunu Testcontainers'ın imaj çekmesi ve testler alıyor. Süre uzarsa imaj önbelleği düşünülebilir.
- main'e doğrudan push artık teknik olarak da imkânsız; CLAUDE.md'deki "CI kurulana kadar lokal kontrol" istisnası kalktı.
- Strict kural yüzünden main ilerledikten sonra bir PR'ın dalı güncellenip CI yeniden çalışmalı.
- Yeni bir high ya da critical açık, kodla ilgisi olmayan bir PR'ı da kırmızıya düşürebilir. O durumda bağımlılık güncellenir. Düzeltmesi yoksa `ci.yml`'deki audit komutuna `--ignore <GHSA>` eklenir ve hemen üstüne neden etkilenmediğimiz yorum olarak yazılır; böylece istisna ve gerekçesi PR'da incelenir.
- `audit` npm'in advisory servisine bağlı ve zorunlu bir check. Servis kesilirse bütün merge'ler bloklanır; kısa bir kesintide beklenir, uzarsa geçici çözüm ayrı bir PR'da konuşulur.
- **Bilinçli sınırlama:** `pull_request`, PR'ın kendi `ci.yml`'ini çalıştırır. Bir PR adımları `run: true` yapabilir ya da `check`/`audit` adlı, hep yeşil job'lar içeren yeni bir workflow ekleyebilir; zorunlu check'ler yine yeşil görünür. Onay sayısı 0 olduğu için tek savunma `.github/` değişikliklerinin merge'den önce elle okunması (`/alt-bolum-bitir` bunu ayrıca hatırlatıyor, reviewer agent'ları da bakıyor). Kişisel repoda organizasyon düzeyindeki "required workflows" yok.
- Public repoda self-hosted runner kullanılmaz: fork PR'ının kodu runner'da Docker ile çalışır. Faz 2–4'te k3s ya da VPS üzerinde runner kurmak cazip görünse de bu kural geçerli.
- Action güncellemeleri elle yapılıyor (SHA ve sürüm yorumu birlikte değişir). Otomatik güncelleme (Dependabot/Renovate) park alanında.
- Job adları (`check`, `audit`) dal korumasında birebir geçiyor; değiştirilirse koruma kuralı da güncellenmeli.
