# Liman — Notlar

Faz özetleri ve mülakat hazırlığı. Alt bölüm notları önce "Taslak notlar" altında birikir, faz sonunda (`/faz-kapat`) faz bölümüne işlenir.

## Taslak notlar

### 1.1 Uygulama yönetimi

- Uçlar: `GET/POST /api/apps`, `GET/PATCH/DELETE /api/apps/:id`, `GET/PUT /api/apps/:id/env`. Oluştururken kurulumun sahibi, repo (`findInstalledRepo`; ID ile doğrudan sorgu her public repoyu bulur) ve dal (`getBranch`) GitHub'dan kontrol ediliyor; eşleşme için yalnızca `repo_id` kullanılıyor. Subdomain yarışını DB'deki unique kısıt çözüyor (5 eşzamanlı istekten tam biri 201). PATCH yalnızca dal, port ve sağlık yolunu değiştiriyor; ad ve subdomain sabit. Liste subdomain'e göre sıralı, imleç son subdomain (base64url).
- Env: AES-256-GCM, değer başına rastgele 12 baytlık nonce, `v1:` öneki, AAD = `app_id:key`. Kod `@liman/db`'de, çünkü API yazıyor, worker 1.5'te okuyacak ve panel bu paketi göremiyor. Anahtar açılışta `KeyObject` olarak ayrıştırılıyor; yoksa API başlamıyor. Değerler API'den hiç geri dönmüyor. PUT bütün listeyi alıyor: listede olmayan silinir, değeri boş gelen eski değerini korur (şifreli metni ve `updated_at`'i değişmez), yeni anahtar boş gelirse 400. PUT uygulama satırını `FOR NO KEY UPDATE` ile kilitliyor (1.2'deki build eklemelerinin FK kilidini bekletmez); eşzamanlı yazmalar sırayla işleniyor ve sonuç karışık bir liste olmuyor.
- Silme: koşullu güncelleme `active → deleting`, commit'ten sonra `liman-pipeline` kuyruğuna `cleanup-app` (iş kimliği = app id), 202. Tekrar çağırmak güvenli: `deleting` bir uygulama için iş yeniden eklenir (aynı kimlik, çift iş yok), başarısız iş yeniden denenir. API commit ile kuyruk arasında çökerse silmeyi tekrar etmek yetiyor. İşi işleyecek worker 1.5'te geliyor; o zamana kadar uygulama `deleting`'de bekler ve subdomain dolu kalır. Panelde `deleting` bir uygulama için "Retry cleanup" düğmesi var (aynı DELETE).
- 0.8'den kalan yarış gerçekti ve düzeltildi. Senkron, silinecek kurulumları tek bir `DELETE … WHERE NOT EXISTS (apps)` ile siliyordu. READ COMMITTED'da bu sorgu, aynı anda eklenen uygulamanın commit'ini bekledikten sonra NOT EXISTS'i eski anlık görüntüyle değerlendiriyor, uygulamayı görmüyor ve RESTRICT girişi 23001 ile düşürüyordu. Artık önce satırlar `FOR UPDATE` ile kilitleniyor, DELETE yeni bir sorgu olarak taze anlık görüntüyle çalışıyor; uygulama oluşturma da kurulum satırını `FOR KEY SHARE` ile tutuyor. Düzeltme geri alınınca test 23001 ile kırılıyor.
- Panel: ana sayfa uygulama listesi oldu. `/apps/new` sihirbazı kurulum → repo → dal → ayrıntılar sırasıyla ilerliyor; ad ve subdomain repo adından öneriliyor, alanlar shared şemalarıyla önceden doğrulanıyor, API'nin alan hataları alanın yanında gösteriliyor. `/apps/:id` ayrıntıları, env düzenleyiciyi (değerler yalnızca yazılır, kayıttan sonra kutular boşalır) ve onaylı silmeyi içeriyor. Park alanından onaylı clickjacking koruması: Traefik middleware'i panel ve API cevaplarına `X-Frame-Options: DENY` ve `frame-ancestors 'none'` ekliyor (curl ile doğrulandı).
- **Kırılgan noktalar:**
  - Clickjacking başlıkları yalnızca Traefik'te; API'ye Traefik'siz gelen istek başlıksız döner. Faz 2'de K8s'te Traefik Middleware kaynağı olarak yeniden yazılmalı. Otomatik testi yok, yalnızca curl ile denendi.
  - `express.json` sınırı rotaya göre değişiyor: env için 6.5 MB, diğerleri için 16 KB. Env router'ı apps router'ından **önce** bağlanmalı, yoksa 16 KB'lık parser env isteğini 413 ile reddeder (bir test bunu yakalıyor).
  - Tamamlanmış bir `cleanup-app` işi Redis'te durduğu sürece (son 1000 iş) aynı kimlikle yeni iş eklenemez. Uygulama satırı iş bitince silindiği için bugün sorun değil; ama worker satırı silmeden işi başarılı bitirirse silme bir daha tetiklenemez (1.5'te dikkat).
  - Kurulum kaldırılınca uygulamalara ne olacağı (RESTRICT) 1.2'deki webhook senkronunda karara bağlanacak.
  - Env değişince çalışan uygulama yenilenmiyor; "Yeniden deploy et" uyarısı 1.5'te geliyor.
  - 1.5 için: worker sağlık adresini `new URL(healthPath, base)` ile değil, sabit `http://<konteyner>:<port>` + yol birleştirerek kurmalı ve sonra host'u kontrol etmeli. Şema `//` ile başlayan ve `.`/`..` içeren yolları zaten reddediyor (güvenlik denetimi: `//redis:6379` iç ağa istek attırırdı). Worker git ve docker'ı `process.env`'i aktarmadan, açık bir `env` ile çalıştırmalı.
  - Env'in toplam boyutu sınırsız: 100 × 32 KB = 3,2 MB, Linux'un `execve` sınırının (~2 MB) üstünde; kullanıcı kendi konteynerinin açılmasını engelleyebilir. Toplam sınır kararı Enes'te.
  - Aynı başarısız işi eşzamanlı iki DELETE'in `retry` etmesine karşı `queue.ts`'de bir `try/catch` var, ama yarışı güvenilir şekilde üreten bir test yazılamadı (yazılan test düzeltmesiz de geçiyordu, kaldırıldı).
- İnceleme ve güvenlik denetimi düzeltmeleri: panelin kendi host'u (`LIMAN_PUBLIC_URL`) subdomain olarak alınamıyor; GitHub'ın yeniden adlandırılmış dala yaptığı yönlendirme reddediliyor; env anahtarı en fazla 128 karakter; `url` alanı yalnızca http(s); sihirbaz forma eşlenemeyen alan hatalarını da gösteriyor; env kutuları parola yöneticilerine kapalı ve düz değerler mutation önbelleğinde kalmıyor; PATCH'in koşullu UPDATE'i ve kilit yarışları artık deterministik testlerle (`pg_stat_activity`) doğrulanıyor.

## Faz 0 — İskelet · `v0.1.0`

Faz 0'ın sonunda Liman'da henüz build ya da deploy yok. Bu fazda bunların duracağı zemin kuruldu: monorepo, ortak paket, yerel compose ortamı, veritabanı şeması, yapılandırma ve loglama, GitHub App, giriş ve oturum, kurulumlar ve repo listesi, panel iskeleti, CI ve dokümantasyon. `pnpm stack:up` ile bütün servisler ayağa kalkıyor. GitHub ile giriş yapınca App kurulup panelde repolar listeleniyor. İzin listesinde olmayan bir hesap giremiyor. Bütün bunlar CI'da 372 testle kontrol ediliyor.

### Ne yapıldı, neden böyle

**Monorepo ve araçlar (0.1, ADR-0001)**

- Tek repo, pnpm workspaces: `apps/api`, `apps/worker`, `apps/web`, `packages/shared`, `packages/db`. Bir durum adı ya da hata kodu tek PR'da değişiyor ve TypeScript bütün tüketicileri birlikte kontrol ediyor. pnpm'in katı `node_modules` yapısı sayesinde panel `pg`'yi göremiyor.
- Sürümler sabit:
  - Node 26: `.nvmrc`, `engines` ve `pnpm-workspace.yaml`'daki `engineStrict` ile.
  - pnpm: `packageManager` ile.
  - Bağımlılıklar `^` olmadan tam sürümle yazılıyor ve `--frozen-lockfile` ile kuruluyor.
  - Kurulum betikleri varsayılan olarak kapalı; yalnızca esbuild'inki çalışıyor.
- TypeScript strict (`noUncheckedIndexedAccess` dahil) tek bir temel yapılandırmadan geliyor. ESLint `strictTypeChecked` ile çalışıyor ve `any` kullanımı hata veriyor. Vitest `projects` ile her paketi kendi ortamında çalıştırıyor. Prettier'ı CI denetliyor.
- Turborepo/Nx elendi: beş paketlik bir repoda `pnpm -r` yetiyor. Ayrı repolar da elendi: her şema değişikliği üç ayrı PR olurdu.

**Ortak paket (0.2)**

- `@liman/shared` şunları içeriyor:
  - durum sabitleri; API'nin ve worker'ın iptal edebileceği durumlar ayrı listelerde,
  - subdomain doğrulayıcı,
  - env şemaları,
  - API hata biçimi,
  - env ayrıştırma yapı taşları.
- Paket Node'da da tarayıcıda da çalışıyor. Bu yüzden env değer sınırı `TextEncoder` ile byte cinsinden ölçülüyor.
- Doğrulayıcı hata fırlatmıyor, sebep kodu dönüyor (`reserved`, `punycode_prefix`…); API ve panel aynı kodu kullanıyor. `xn--` önekleri, benzer görünen adlara karşı reddediliyor.
- Geliştirmede shared ve db kaynaktan okunuyor (`liman-source` export koşulu), önce build gerekmiyor. api ve worker üretimde `dist/` kullanıyor; panel shared'ı her zaman kaynaktan paketliyor.

**Yerel ortam (0.3)**

- Tek geliştirme imajı api, worker, web ve migrate'i çalıştırıyor. Kod `docker compose watch` ile senkronlanıyor, çünkü Windows'ta bind mount dosya değişikliklerini konteynere bildirmiyor. Konteynerler `node` kullanıcısıyla çalışıyor.
- İki ağ var: `liman-internal` (Liman'ın kendi servisleri) ve `liman-apps` (Faz 1'deki kullanıcı uygulamaları, Traefik ve worker). Dışarı açık tek port Traefik'in 80'i, geri kalanı host'ta `127.0.0.1`'e bağlı.
- api ve worker, postgres ile redis sağlıklı olana ve tek seferlik `migrate` başarıyla bitene kadar başlamıyor.

**Veritabanı (0.4, ADR-0018)**

- Bölüm 7'deki 9 tablo Drizzle ile ayrı bir `packages/db` paketinde. Paketi yalnızca api ve worker kullanıyor.
- Durum alanları enum değil, `text` + `CHECK`; değerler shared'daki sabitlerden geliyor.
- "Uygulama başına tek aktif deployment" kuralını kısmi unique index (`WHERE status = 'active'`) sağlıyor. İki eşzamanlı `active` eklemesinde ikincisi `23505` alıyor; bunu bir eşzamanlılık testi doğruluyor.
- Biçimleri DB de zorluyor:
  - `token_hash` hex SHA-256,
  - `value_enc` `v1:` önekli,
  - `image_ref` digest'li.

  Bileşik FK, deployment'ı yalnızca kendi uygulamasının build'ine bağlıyor.

**Yapılandırma ve loglama (0.5)**

- api ve worker açılışta env'i Zod ile doğruluyor. Hatalı bir değerde süreç dinlemeye başlamadan `exit 1` ile kapanıyor; mesajda yalnızca değişken adı geçiyor, değer asla geçmiyor.
- Express 5 ve pino JSON log kullanılıyor. Her isteğin bir kimliği var (`X-Request-Id`). Dışarıdan gelen bir kimlik yalnızca güvenli biçimdeyse kabul ediliyor, log enjeksiyonu yapılamıyor.
- Gizli başlıklar `[redacted]` yazılıyor. Sorgu dizesi hiç loglanmıyor. DB hatalarından yalnızca hata kodu ve kısıt adı yazılıyor, SQL parametreleri yazılmıyor.

**GitHub App (0.6, ADR-0002)**

- Geliştirme App'i `liman-dev-06`. Yetkileri yalnızca Contents ve Metadata read, abone olduğu olay `push`. Kurulum adımları `docs/github-app-setup.md`'de.
- OAuth App elendi:
  - `repo` kapsamı bütün repolara okuma-yazma verir,
  - repo seçilemez,
  - token saklanmak zorunda kalır,
  - her repoya ayrı webhook gerekir.
- "Request user authorization during installation" kapalı. Açık olsaydı Setup URL devre dışı kalır ve callback `state`/PKCE'siz bir akışa açılırdı.
- smee kanalı açıldı. İstemciyi çalıştırmak 1.2'ye kaldı: hedef uç olmadan her teslimat 404 alırdı.

**Kimlik (0.7, ADR-0003)**

- Giriş GitHub App kullanıcı yetkilendirmesiyle yapılıyor (web akışı + PKCE S256). `state` ve verifier tek bir httpOnly çerezde 10 dakika duruyor. `state` sabit zamanlı karşılaştırılıyor; tutmazsa GitHub'a hiç gidilmiyor.
- İzin listesi numerik GitHub ID'yle tutuluyor. Listede olmayan bir hesap için `users` satırı bile açılmıyor. Listeden çıkarılan birinin açık oturumu bir sonraki istekte düşüyor.
- Oturum:
  - 32 bayt rastgele token; DB'de yalnızca SHA-256 hash'i duruyor.
  - Süre sabit, kullanımla uzamıyor.
  - Çerez httpOnly, SameSite=Lax; üretimde ayrıca Secure ve `__Host-` önekli.
- Kardeş subdomain'ler aynı site sayıldığından SameSite yetmiyor. `/api` altındaki her yazma isteğinde `Origin` birebir eşleşmeli, yoksa 403.
- Giriş ucunda Redis'te hız sınırı var: IP başına dakikada 10, IPv6'da /64 başına. Redis yoksa istek 500 alıyor; sınır atlanmıyor.

**Kurulumlar ve repolar (0.8, ADR-0002)**

- Setup dönüşündeki `installation_id`'ye güvenilmiyor; tarayıcı yeniden girişe yönlendiriliyor. Callback kullanıcının kendi token'ıyla `GET /user/installations` çağırıyor ve listeyi tek transaction'da senkronluyor. Liste sıralı işleniyor, böylece iki eşzamanlı giriş deadlock'a düşmüyor.
- Kullanıcı token'ı yalnızca `withUser` bloğunda yaşıyor ve blok nasıl biterse bitsin GitHub'da iptal ediliyor.
- App JWT `node:crypto` ile RS256 imzalanıyor. Installation token'ları süreç belleğinde, bitişe 5 dakika kalana kadar tutuluyor ve yalnızca `metadata: read` yetkisi taşıyor.
- Repo erişimi kurulumun kendi listesinden kontrol ediliyor (`findInstalledRepo`). Installation token herhangi bir public repoyu okuyabildiği için `GET /repositories/:id` bu kontrolde kullanılamaz.
- Hata kodları:
  - 401: oturum yok
  - 403: başkasının kurulumu
  - 404: kurulum yok
  - 409: kurulum askıda
  - 502: `upstream_failed`

  Hepsi Bölüm 10'a eklendi.

**Panel (0.9, ADR-0019)**

- React, Vite, TanStack Query, Tailwind ve React Router kullanılıyor; testler Vitest, jsdom ve Testing Library ile.
- Oturum kapısı router'ın dışında: 401 gelince hangi yoldaysan giriş sayfası açılıyor.
- Panel ile API aynı origin'de, bu yüzden CORS gerekmiyor. Her cevap shared şemasıyla doğrulanıyor.
- 401'de ve çıkışta önce havadaki istekler iptal ediliyor, sonra önbellek temizleniyor. Geç gelen bir `/api/me` kullanıcıyı geri getiremiyor; bunu bir race testi doğruluyor.

**CI (0.10, ADR-0020)**

- İki job var:
  - `check`: lint, typecheck, format, Testcontainers dahil bütün testler ve build.
  - `audit`: `pnpm audit --prod --audit-level high`, ayrıca haftada bir.
- Action'lar SHA ile sabitli, token salt okunur.
- main dal koruması:
  - PR zorunlu,
  - iki check yeşil olmalı ve dal güncel olmalı (strict),
  - kurallar adminlere de uygulanıyor,
  - force push ve dal silme kapalı.
- Merge'ler squash: main'de her alt bölüm tek commit. Concurrency ayarı PR'da eski çalışmayı iptal ediyor, main'de her commit'i ayrı çalıştırıyor.

**Dokümantasyon (0.11)**

- ADR-0001 yazıldı ve README iskeleti tamamlandı: CI rozeti, "How it works", faz tablosu, Uygulama Sözleşmesi, doküman linkleri.
- ADR'yi kodla karşılaştırırken iki gerçek hata çıktı ve düzeltildi:
  - pnpm 12 `.npmrc`'deki `engine-strict`'i okumuyordu,
  - api'nin `watch` listesinde `packages/db/src` yoktu.

**İncelemelerin yakaladıkları.** Fazın en öğretici kısmı bu oldu; her biri gerçek ortamda ya da bir testle doğrulandı:

- `Location` başlığından ve DB hatalarından loga sır sızıyordu.
- Installation token, kuruluma eklenmemiş public repoları da okuyabiliyordu.
- Eşzamanlı senkronlar deadlock'a düşüyordu.
- Panelde arka plan yenilemesi hata verince yüklü liste kayboluyordu.
- CI concurrency ayarı main'deki çalışmaları iptal ediyordu.
- `engine-strict` etkisizdi.

### Kırılgan noktalar (Faz 1'e devredenler)

**Güvenlik**

- Traefik paneli `api.insecure: true` ile konteyner ağında kimlik doğrulamasız açık, Traefik de `liman-apps` ağında. İlk kullanıcı uygulaması bu ağa girmeden kapatılmalı (park alanında).
- Docker socket'in `:ro` bağlanması API çağrılarını kısıtlamıyor; socket'e erişen her süreç host'ta root sayılır. Faz 1'de worker da erişecek (ADR-0006).
- Clickjacking koruması yok. Faz 1'deki ilk durum değiştiren düğmeyle birlikte `frame-ancestors 'none'` gelmeli (park alanında).
- smee kanal sayfası gövdeyi imzasıyla gösteriyor. `X-GitHub-Delivery` imzanın kapsamında değil, bu yüzden tekrar oynatmaya karşı commit bazlı idempotency 1.2'de değerlendirilecek.
- `trust proxy = 1` önde tek vekil olduğunu varsayıyor; Faz 2'de hop sayısı yeniden kontrol edilmeli. API önünde Traefik olmadan çalışırsa hız sınırı atlatılabilir.
- Redaction yol tabanlı. Loga nesnenin tamamı değil, seçilmiş alanlar yazılmalı. Sorgu dizeleri ve DB parametreleri sır taşıyabilir.
- `audit` yalnızca üretim bağımlılıklarındaki high/critical açıklara bakıyor. Bir PR kendi `ci.yml`'ini çalıştırdığı için `.github/` değişiklikleri merge'den önce elle okunmalı.

**Veri ve senkron**

- GitHub'da erişimini kaybeden kullanıcının, app bağlı kurulum satırı silinmiyor. Faz 1'de "erişim kaybedildi" işareti düşünülecek.
- `POST /api/apps` senkronla aynı anda çalışırsa RESTRICT hatası girişi 500'e düşürebilir; bunun testi yazılmalı. App oluşturma da `findInstalledRepo` kullanmalı.
- Kurulum bilgisi yalnızca giriş anındaki kadar güncel. Webhook senkronu 1.2'de.
- Faz 1'de claim, `heartbeat_at`'i hemen set etmeli; yoksa reaper o build'i görmez.
- Durum listeleri hem TypeScript'te hem DB `CHECK`'lerinde var. Liste değişince migration da üretilmeli. Uygulanmış bir migration düzenlenmez, değişiklik yeni bir migration olur. RESTRICT ihlali `23001` koduyla döner.

**Geliştirme ortamı**

- Yeni bir paket eklenince `dev.Dockerfile`'daki kopyalama satırları ve compose `watch` listesi elle güncellenmeli. CI geliştirme imajını derlemiyor, bu yüzden `pnpm stack:up` elle denenmeli.
- `liman-source` koşulunu tanımayan bir araç shared'ı `dist/`'ten okumaya çalışır.
- Panelin `apiErrorSchema`'sı katı bir enum. API ile shared'daki hata kodları birlikte güncellenmeli.
- Repo listesi GitHub'ın offset sayfalamasını kullanıyor; sayfalar arasında bir repo kaybolabilir.
- Stack dolu bir `.env` ve `secrets/app.pem` olmadan kalkmıyor. Testler Docker istiyor.
- README'deki faz tablosu ve Uygulama Sözleşmesi elle güncelleniyor; ikincisi ROADMAP Bölüm 3'ün kopyası.

### Kontrol soruları

**GitHub App ile OAuth App farkı ne, neden App seçtik?**
OAuth App kullanıcı adına çalışır. `repo` kapsamı kullanıcının bütün repolarına okuma-yazma verir ve token'ın saklanması gerekir. GitHub App ise kurulumla çalışır: kullanıcı hangi repoları vereceğini kendisi seçer, yetkiler ince ayarlıdır (bizde yalnızca Contents ve Metadata read). Erişim, en fazla 1 saat geçerli installation token'larıyla yapılır ve kurulu bütün repolar için tek merkezi bir webhook vardır. Daha az yetki, saklanan sır yok, tek webhook.

**Setup dönüşünde gelen `installation_id`'ye neden güvenmiyoruz?**
Değer URL'den geliyor, yani herkes `?installation_id=<başkasınınki>` ile bu adresi açabilir. GitHub bu dönüşü imzalamaz. Kaydedersek başkasının kurulumunu kendimize bağlamış oluruz. Bu yüzden setup ucu hiçbir şey yazmıyor, tarayıcıyı yeniden girişe yolluyor. Callback, kullanıcının kendi token'ıyla GitHub'a "bu kullanıcı hangi kurulumlara erişebiliyor?" diye soruyor ve yalnızca o listeyi kaydediyor. App JWT ile doğrulama elendi, çünkü organizasyon kurulumunda kullanıcının orada yetkisi olup olmadığını göstermiyor.

**Oturum çerezi neden httpOnly? SameSite=Lax neyi engeller, neyi engellemez?**
httpOnly çereze JavaScript erişemez. Bir XSS açığı olsa bile oturum token'ı çalınıp başka yerden kullanılamaz.

SameSite=Lax neyi engeller:
- Çerez başka sitelerden gelen POST, `fetch` ve iframe isteklerinde gönderilmez. Klasik CSRF (başka bir sitedeki gizli form) bu yüzden çalışmaz.

Neyi engellemez:
- Üst seviye GET gezinmelerinde (bir linke tıklamak) çerez yine gönderilir. Bu yüzden GET hiçbir şeyi değiştirmemeli.
- Kardeş subdomain'ler (`app.alanadi.com` ve `liman.alanadi.com`) aynı **site** sayılır, oradan gelen istek de çerezi taşır. Kullanıcı uygulamaları kardeş subdomain'de çalıştığı için `/api` altındaki her yazma isteğinde `Origin` başlığını birebir kontrol ediyoruz.
- Clickjacking'i de engellemez; o, `frame-ancestors` ile çözülür.

**Ortam değişkenlerini açılışta doğrulamak neden önemli?**
Hata en erken ve en açık yerde çıkıyor. Eksik ya da hatalı bir değerle süreç hiç başlamıyor ve mesaj hangi değişkenin sorunlu olduğunu söylüyor. Doğrulama olmasaydı hata saatler sonra, o değeri ilk kullanan istekte ortaya çıkardı: yarım kalmış bir build, anlamsız bir 500 ya da yanlış bir varsayılanla sessizce çalışan güvenlik ayarı. Mesajda değer değil yalnızca değişken adı yazıyor, çünkü değer bir parola olabilir.
