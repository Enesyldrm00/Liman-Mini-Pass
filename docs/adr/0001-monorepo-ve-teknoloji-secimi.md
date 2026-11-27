# 0001 — Monorepo ve teknoloji seçimi

- Durum: Kabul edildi
- Tarih: 2026-11-27
- Faz: 0

## Bağlam

Liman dört parçadan oluşuyor: API, worker, panel ve bunların ortak kullandığı şemalar/sabitler. API ile worker aynı durum makinelerini (Bölüm 8) ve aynı veritabanını kullanıyor; panel API'nin cevaplarını aynı Zod şemalarıyla doğruluyor. Bir durum adı ya da hata kodu tek yerde değişmeli, üç ayrı yerde değil.

Projeyi tek kişi geliştiriyor ve proje aynı zamanda mülakatta anlatılacak bir portfolyo işi. Bu yüzden araç sayısı az, her aracın varlık sebebi tek cümlede anlatılabilir olmalı. Ortam tekrar üretilebilir olmalı: aynı commit, Windows'taki geliştirme makinesinde, compose konteynerinde ve CI'da aynı sürümlerle çalışmalı.

Bu ADR, Bölüm 4'teki yığının Faz 0'da kurulan kısmını ve 0.1–0.3'te verilen kararları kayda geçiriyor. Veritabanı katmanı (ADR-0018), panelin yönlendirme ve test ortamı (ADR-0019) ve CI (ADR-0020) kendi ADR'lerinde; burada tekrar edilmiyor.

## Karar

- **Tek repo, pnpm workspaces.** Paketler `apps/api`, `apps/worker`, `apps/web`, `packages/shared` ve 0.4'te eklenen `packages/db`. Paketler birbirine `workspace:*` ile bağlanıyor, ortak bağımlılıklar tek `pnpm-lock.yaml`'da. pnpm'in katı `node_modules` yapısı bir paketin bildirmediği bir bağımlılığı kullanmasını engelliyor; panelin `pg`'yi görememesi bu sayede kendiliğinden sağlanıyor.
- **Sürümler sabit.** Node `.nvmrc` (26) ve `engines` (`>=26 <27`) ile, pnpm `packageManager` (`pnpm@12.19.0`) ile sabitleniyor. Bağımlılıklar `^` olmadan, tam sürümle yazılıyor; CI ve geliştirme imajı `--frozen-lockfile` ile kuruyor; `.npmrc`'deki `engine-strict` yanlış Node sürümünde kurulumu durduruyor. Kurulum betikleri varsayılan olarak kapalı, yalnızca `pnpm-workspace.yaml`'daki `allowBuilds` listesindekiler (bugün yalnızca esbuild) çalışıyor.
- **TypeScript strict, tek temel yapılandırma.** `tsconfig.base.json`'da `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `verbatimModuleSyntax` ve `isolatedModules` açık. Modül sistemi ESM (`"type": "module"`, `NodeNext`). Her paket `tsc -b tsconfig.build.json` ile `dist/`'e derleniyor; derleme sırasını `pnpm -r` bağımlılık grafiğinden çıkarıyor. Typecheck ayrı bir `tsconfig.json` ile, çıktı üretmeden yapılıyor.
- **`@liman/shared` geliştirmede kaynaktan okunuyor.** Paketin `exports` alanında `liman-source` koşulu `src/index.ts`'yi, varsayılan koşul `dist/`'i gösteriyor. tsx (api/worker geliştirme), Vite (panel), Vitest ve typecheck (`customConditions`) bu koşulla kaynağı okuyor, yani shared'da bir değişiklik için önce build gerekmiyor. Üretim derlemesi `dist/`'i kullanıyor.
- **Tek lint/format/test yapılandırması kökte.** ESLint flat config, `typescript-eslint` strict + type-checked kurallar; `no-explicit-any` hata. Prettier biçim kararlarını tartışmaya kapatıyor; CI `format:check` ile kontrol ediyor. Vitest kökte `projects: ["apps/*", "packages/*"]` ile her paketi kendi ortamında (Node ya da jsdom) çalıştırıyor. Ortak betikler kökte: `build`, `lint`, `typecheck`, `test`, `format`, `stack:*`.
- **Sunucu tarafı: Express 5 + Zod + pino.** Express 5 async route'lardaki hataları kendisi yakalıyor; en yaygın ve en iyi bilinen Node HTTP çatısı, mülakatta ek açıklama gerektirmiyor. Girdi ve ortam değişkenleri Zod ile doğrulanıyor, şemalar shared'da. Loglar pino ile JSON (Faz 3'te Loki'de sorgulanacak).
- **Yerel ortam Docker Compose, tek geliştirme imajı.** `infra/compose/dev.Dockerfile` bağımlılıkları imajın içinde, Linux için kuruyor; api, worker, web ve migrate aynı imajdan farklı komutlarla çalışıyor. Kaynak kod bind mount ile değil `docker compose watch` ile senkronlanıyor: Windows'ta bind mount üzerinden dosya izleme yavaş ve güvenilmez, host'taki Windows `node_modules`'ü de konteynerde çalışmaz. Konteynerler root değil `node` kullanıcısıyla çalışıyor.
- **Compose'da iki ağ.** `liman-internal` Liman'ın kendi servisleri için; `liman-apps` Faz 1'deki kullanıcı uygulamaları, Traefik ve worker için. Kullanıcı uygulamaları `liman-internal`'a hiç girmiyor. Postgres, Redis, registry ve Traefik paneli host'ta yalnızca `127.0.0.1`'e açılıyor; dışarı açık tek port Traefik'in 80'i. api, postgres ve redis sağlıklı olana ve tek seferlik `migrate` servisi başarıyla bitene kadar başlamıyor.

## Elenen alternatifler

- **Ayrı repolar** (api, worker, web, shared): Ortak şemalar bir paket olarak yayınlanıp her değişiklikte sürüm atlatılmak zorunda kalırdı. Bir durum adı değişikliği üç PR demek olurdu. Tek kişilik bir projede bu yük boşa.
- **Turborepo / Nx:** Görev önbelleği ve bağımlılık grafiğine göre paralel çalıştırma veriyorlar. Beş paketlik bir repoda `pnpm -r` topolojik sırayı zaten kuruyor ve build birkaç saniye sürüyor. Ek bir araç, ek bir yapılandırma dosyası ve anlatılacak bir kavram daha olurdu. İhtiyaç doğarsa sonradan eklenebilir.
- **npm veya Yarn workspaces:** npm workspaces düz `node_modules` kullanıyor, bildirilmemiş bağımlılıklar sessizce çalışıyor. Yarn Berry'nin Plug'n'Play'i bazı araçlarla (Vite, tsx, Testcontainers) ek ayar istiyor. pnpm ikisinin arasında: katı ama uyumlu.
- **NestJS:** Modül, DI ve dekoratör katmanı bu boyuttaki bir API için fazla soyutlama; durum geçişlerinin ve SQL'in açıkça görünmesini istiyoruz (Bölüm 8).
- **Fastify:** Daha hızlı ve şema doğrulaması yerleşik. Ama darboğaz HTTP katmanı değil, build ve deploy; Express 5 async hataları artık kendisi yakaladığı için Fastify'ın bu konudaki üstünlüğü de kalmadı. Ekosistem ve tanınırlık Express'ten yana.
- **Hono:** Edge/çoklu runtime için tasarlanmış; Liman yalnızca Node'da çalışıyor, bu esnekliğe ihtiyaç yok.
- **Jest:** ESM ve TypeScript için ek dönüştürücü gerektiriyor. Vitest ikisini doğrudan destekliyor ve panelin Vite yapılandırmasıyla aynı dönüşüm hattını kullanıyor.
- **ESLint + Prettier yerine Biome:** Tek ve hızlı bir araç, ama tip bilgisi kullanan kuralları `typescript-eslint`'in `strictTypeChecked` setinin gerisinde (`no-misused-promises`, `no-unnecessary-condition` gibi). Async ağırlıklı bir kod tabanında bu kurallar gerçek hata yakalıyor.
- **Geliştirmede bind mount:** Windows'ta dosya olaylarının konteynere ulaşmaması ve host ile konteyner arasında `node_modules` çakışması yüzünden elendi.

## Sonuçlar

- Bir şema ya da sabit tek PR'da değişiyor ve TypeScript bütün tüketicilerini aynı anda kontrol ediyor. Panel ile API'nin hata kodları da aynı enum'dan geliyor; ikisi birlikte güncellenmeli (0.9 notu).
- `liman-source` koşulunu tanımayan bir araç shared'ı `dist/`'ten okumaya çalışır; o durumda önce `pnpm build` gerekir. Yeni bir araç eklerken bu koşul ayarlanmalı.
- Sabit sürümler güncellemeyi elle yapılacak bir iş hâline getiriyor. Güvenlik açıklarını CI'daki `pnpm audit` yakalıyor (ADR-0020); otomatik sürüm güncelleme aracı (Dependabot/Renovate) yok.
- Yeni bir paketi `pnpm-workspace.yaml` deseni kendiliğinden kapsıyor, ama `dev.Dockerfile`'daki `package.json` kopyalama satırları ve compose `watch` listesi elle güncellenmeli (0.4'te `packages/db` için Dockerfile'a satır eklendi).
- Geliştirme ortamı Docker'a bağlı: yerel stack ve veritabanı testleri (Testcontainers) Docker olmadan çalışmıyor.
- Faz 2'de K8s'e geçişte compose yalnızca yerel geliştirme ve testler için kalıyor; buradaki ağ ayrımının karşılığı NetworkPolicy olacak (ADR-0011).
