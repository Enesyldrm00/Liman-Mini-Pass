# Liman — Notlar

Faz özetleri ve mülakat hazırlığı. Alt bölüm notları önce "Taslak notlar" altında birikir, faz sonunda (`/faz-kapat`) faz bölümüne işlenir.

## Taslak notlar

### 0.1 Monorepo

- pnpm workspace: `apps/api`, `apps/worker`, `apps/web`, `packages/shared` (0.4'te `packages/db` eklendi). Node 26 `.nvmrc` + `engines` + `engineStrict` ile, pnpm `packageManager` ile sabit; bağımlılıklar `^` olmadan tam sürümle yazılıyor. Kurulum betikleri varsayılan olarak kapalı, yalnızca `allowBuilds`'teki esbuild çalışıyor (ADR-0001).
- TypeScript strict tek bir `tsconfig.base.json`'dan geliyor (`noUncheckedIndexedAccess` dahil). ESLint flat config `strictTypeChecked` kullanıyor ve `any` hata veriyor. Vitest kökte `projects` ile her paketi kendi ortamında çalıştırıyor. Ortak betikler kökte.
- **Kırılgan noktalar:**
  - `tsbuildinfo` dosyaları ilk commit'lerde yanlışlıkla repoya girdi, 0.2'de `.gitignore`'a eklendi. Yeni bir derleme çıktısı türü eklenirse önce ignore'a bakılmalı.
  - Sabit sürümleri güncelleyen bir otomasyon yok. CI'daki `pnpm audit --prod --audit-level high` yalnızca üretim bağımlılıklarındaki high/critical açıkları haber veriyor; dev bağımlılıkları denetlenmiyor.
  - `engine-strict` 0.1'de `.npmrc`'ye yazılmıştı ama pnpm 12 onu okumuyor: yanlış Node sürümünde kurulum yalnızca uyarı verip devam ediyordu. 0.11'de `pnpm-workspace.yaml`'a `engineStrict` olarak taşındı (elle denendi: önce exit 0, sonra exit 1). pnpm ayarları artık `pnpm-workspace.yaml`'da; `.npmrc` yalnızca kimlik bilgileri içindir.

### 0.2 Ortak paket

- `@liman/shared`: durum sabitleri ve tipleri (build, deployment, app, log akışı; API'nin ve worker'ın iptal edebileceği durumlar ayrı listeler), subdomain doğrulayıcı, env anahtar/değer şemaları ve standart API hata biçimi. Hem Node'da hem tarayıcıda çalışıyor; bu yüzden env değer sınırı (32 KB) `Buffer` ile değil `TextEncoder` ile byte olarak ölçülüyor.
- Subdomain doğrulayıcı hata fırlatmıyor, sebep kodu dönüyor (`empty`, `too_long`, `invalid_chars`, `leading_or_trailing_hyphen`, `punycode_prefix`, `reserved`). Aynı kodu API 400 cevabında, panel form mesajında kullanabilecek. `xn--` önekli adlar reddediliyor, çünkü punycode bir etiket başka bir adın benzeri gibi görünebilir.
- Geliştirmede shared kaynaktan okunuyor (`liman-source` export koşulu), build gerekmiyor (ADR-0001).
- **Kırılgan noktalar:**
  - Durum listeleri hem TypeScript'te hem DB `CHECK` kısıtlarında var (0.4). Liste değişince migration da üretilmeli.

### 0.3 Yerel ortam

- `pnpm stack:up` tek komutla postgres, redis, registry, traefik, api, worker, web ve tek seferlik `migrate` servisini ayağa kaldırıyor. api ve worker, postgres ve redis sağlıklı olana ve `migrate` başarıyla bitene kadar başlamıyor.
- İki ağ: `liman-internal` Liman servisleri için, `liman-apps` ileride kullanıcı uygulamaları, Traefik ve worker için. Uygulamalar `liman-internal`'daki servislere erişemeyecek; Traefik ise iki ağda da (aşağıdaki kırılgan noktaya bakın). Dışarı açık tek port Traefik'in 80'i; postgres (5433), redis, registry ve Traefik paneli host'ta yalnızca `127.0.0.1`'e bağlı.
- api, worker, web ve migrate aynı geliştirme imajını kullanıyor; bağımlılıklar imajda Linux için kurulu. Kod bind mount yerine `docker compose watch` ile senkronlanıyor, çünkü Windows'ta bind mount dosya değişikliklerini konteynere bildirmiyor. Konteynerler `node` kullanıcısıyla çalışıyor.
- **Kırılgan noktalar:**
  - Traefik Docker socket'ini `:ro` ile bağlıyor, ama `:ro` Docker API çağrılarını kısıtlamaz: socket'e erişen her süreç host'ta fiilen root'tur. Faz 1'de worker da socket'e erişecek (ADR-0006).
  - `127.0.0.1:8080` bağlaması yalnızca host'tan erişimi sınırlıyor. Traefik paneli `api.insecure: true` ile konteyner ağında kimlik doğrulamasız açık; Faz 1'de `liman-apps`'e katılan bir uygulama `traefik:8080/api/rawdata`'dan bütün yönlendirme yapılandırmasını okuyabilir. İlk uygulama gelmeden kapatılmalı (park alanında, 0.11 güvenlik denetimi).
  - Yeni bir paket eklenince `dev.Dockerfile`'daki `package.json` kopyalama satırları ve compose `watch` listesi elle güncellenmeli. 0.4'te db için `watch` satırı unutulmuştu, 0.11'de eklendi.
  - `*.localhost` adını tarayıcılar kendiliğinden çözüyor, Node ve bazı curl sürümleri çözmeyebiliyor; gerekirse hosts dosyası.

### 0.4 Veritabanı

- Bölüm 7'deki 9 tablo `packages/db` paketinde Drizzle ile yazıldı. Paket yalnızca api ve worker için; panel `pg`'yi görmüyor. Tek migration var (`0000_init.sql`), compose'daki `migrate` servisi bunu uyguluyor (ADR-0018).
- "Uygulama başına tek aktif deployment" kuralını kod değil, kısmi unique index sağlıyor: `UNIQUE (app_id) WHERE status = 'active'`. Eşzamanlılık testi bunu doğruluyor: iki transaction aynı anda `active` eklerse ikincisi birincinin commit'ini bekliyor ve sonra `23505` hatası alıyor. Geçişte önce eski deployment `superseded` yapılmalı, sonra yenisi `active`; ikisi aynı transaction'da.
- Durum alanları enum değil, `text` + `CHECK`. Değerler `@liman/shared` sabitlerinden geliyor. Ayrıca bazı biçimleri DB kendisi zorluyor: `token_hash` hex SHA-256 olmalı, `value_enc` `v1:` önekiyle başlamalı, `image_ref` digest içermeli. Deployment'lar bileşik FK ile yalnızca kendi uygulamasının build'ine bağlanabiliyor.
- **Kırılgan noktalar:**
  - Sabit listesi değişip `generate` çalıştırılmazsa TypeScript ile DB birbirinden kopar.
  - `$onUpdate` yalnızca Drizzle üzerinden yapılan güncellemelerde çalışır.
  - RESTRICT ihlali `23503` değil `23001` koduyla döner.
  - Faz 1'de claim, `heartbeat_at` alanını hemen set etmeli; yoksa reaper o build'i göremez.
  - `pnpm test` artık Docker istiyor (Testcontainers).

### 0.5 Yapılandırma ve loglama

- api ve worker açılışta env'i Zod ile doğruluyor (`apps/*/src/config`). Yapı taşları (`parseEnv`, `originSchema`, `portSchema`…) tarayıcıda da çalışabilsin diye `@liman/shared`'da. Hatalı ya da eksik bir değer varsa süreç dinlemeye başlamadan `exit 1` ile kapanıyor. Mesajda yalnızca değişken adı ve sorun yazıyor, değer asla yazmıyor (parola içerebilir). Boş string eksik sayılıyor. Şimdilik yalnızca bağlantı ayarları zorunlu; GitHub ve şifreleme değişkenleri kullanıldıkları alt bölümde şemaya girecek.
- api Express 5'e geçti. pino JSON log basıyor, pino-http her isteğe bir kimlik veriyor ve bu kimlik cevapta `X-Request-Id`, `req.log` satırlarında `reqId` olarak görünüyor. Gelen bir kimlik yalnızca `[A-Za-z0-9._-]{1,64}` biçimindeyse kullanılıyor, böylece log enjeksiyonu yapılamıyor. Bir istemcinin başka bir kimliği taklit edip eşleştirmeyi bulandırması kabul edilen risk.
- Gizleme: `authorization`, `proxy-authorization`, `cookie`, `set-cookie` ve `x-hub-signature(-256)` başlıkları iki iç seviyeye kadar `[redacted]` yapılıyor (`@liman/shared/log-redaction`). Sorgu dizesi hiç loglanmıyor, çünkü 0.7'de OAuth `code` ve `state` orada olacak.
- **Kırılgan noktalar:**
  - Redaction yol tabanlı çalışıyor. Bilinmeyen bir alana (ör. `{ token }`) yazılan sır maskelenmez, o yüzden loga nesneyi bütün olarak değil, seçilmiş alanlarını koy.
  - Uygulanmış bir migration dosyası sonradan değişirse Drizzle onu yeni bir migration sanıyor ve eski volume'da `migrate` kırılıyor. 0.4'ten kalan bir volume'da bu oldu. Kural: bir migration uygulandıysa düzenlenmez, değişiklik yeni bir migration olarak eklenir.
  - Startup testleri `tsx` ile gerçek süreç başlatıyor; yavaş bir makinede 20 saniyelik zaman aşımına takılabilir.

### 0.6 GitHub App

- Geliştirme App'i `liman-dev-06` (`liman-dev` adı GitHub'da alınmıştı; App adları global). Yetkiler yalnızca Contents ve Metadata read, abone olunan tek olay `push`; `installation` ve `installation_repositories` her App'e zaten geliyor. Adımlar `docs/github-app-setup.md`'de. App manifest akışıyla oluşturuldu ve App JWT ile doğrulandı: `ping` ve `installation.created` smee'ye 200 ile ulaştı.
- "Request user authorization during installation" bilinçli olarak kapalı. Açık olsaydı GitHub Setup URL'yi devre dışı bırakıp kullanıcıyı callback'e gönderirdi; 0.8'de gelen `installation_id`'yi doğrulamak için setup dönüşü gerekiyor.
- smee istemcisi (forwarder) 1.2'ye ertelendi (seçenek A): hedef uç yokken her teslimat 404 alırdı. Bu alt bölümde yalnızca kanal açıldı ve App'e bağlandı. Kimlik bilgileri `.env` ve `secrets/app.pem`'de, ikisi de git-ignored.
- **Kırılgan noktalar:**
  - smee kanal sayfası gövdeyi imzasıyla birlikte gösteriyor. HMAC tekrar oynatmayı engellemez ve `X-GitHub-Delivery` imzanın kapsamında değil. Commit bazlı idempotency park alanına eklendi; 1.2'de karar verilecek.
  - 0.8 açık sorusu: `installation_id` doğrulaması `GET /user/installations` ile yapılırsa user token gerekir (saklamıyoruz). Alternatif: App JWT ile `GET /app/installations/:id` ve `account.id` karşılaştırması. 0.8 başında karar, ADR-0002'ye yazılacak.
  - Compose henüz `.env`'i ve `secrets/`'i servislere geçirmiyor; 0.7'de eklenecek. Kurulum şu an "All repositories" ile; en az yetki için "Only select repositories" daha doğru.

### 0.7 Kimlik

- Giriş GitHub App kullanıcı yetkilendirmesiyle (web akışı + PKCE S256) yapılıyor. `state` ve PKCE verifier tek bir httpOnly çerezde (`<state>.<verifier>`, 10 dk) taşınıyor; callback önce `state`'i sabit zamanlı karşılaştırıyor, tutmazsa 400 ve GitHub'a hiç gidilmiyor. Kullanıcı token'ı tek bir `GET /user` çağrısında kullanılıp atılıyor. İzin listesi numerik GitHub ID ile; listede olmayan biri için `users` satırı bile açılmıyor, listeden çıkarılanın açık oturumu bir sonraki istekte düşüyor.
- Oturum: 32 bayt rastgele token, DB'de yalnızca SHA-256 hex; süre sabit (`SESSION_TTL_HOURS`), kullanım uzatmıyor. Çerez httpOnly + SameSite=Lax + `Path=/`; üretimde Secure ve `__Host-` önekli (bu yüzden üretimde `LIMAN_PUBLIC_URL` https zorunlu). Kardeş subdomain aynı site sayıldığı için `/api` altındaki her yazma isteğinde `Origin` panelin origin'iyle birebir eşleşmeli, yoksa 403 (ADR-0003).
- Hız sınırı Redis'te (sabit pencere, `SET NX EX` + `INCR` tek MULTI, IP başına dakikada 10; IPv6 /64'e göre). Redis yoksa istek hızlıca 500 alıyor, sınır atlanmıyor. `trust proxy = 1`: önde tek vekil Traefik var, istemci `X-Forwarded-For` ile kendi IP'sini seçemiyor.
- Gerçek GitHub ile compose stack'inde uçtan uca denendi. Denerken bir sızıntı yakalandı: pino-http cevap başlıklarını logluyor ve GitHub'a yönlendiren `Location`'da `state` vardı. Ayrıca güvenlik denetimi Drizzle hatalarının SQL parametrelerini loga yazdığını buldu; artık yalnızca Postgres hata kodu ve kısıt adı yazılıyor.
- **Kırılgan noktalar:**
  - Stack artık dolu bir `.env` olmadan kalkmıyor (compose `env_file`; bağlantı ayarları yine compose'dan gelir).
  - `trust proxy` vekil sayısına bağlı; API host'ta önünde Traefik olmadan çalışırken hız sınırı `X-Forwarded-For` ile atlatılabilir. Faz 2'de k3s'te hop sayısı yeniden kontrol edilmeli.
  - Yeni bir loglama yolu eklerken: istek/cevap URL'lerinde sorgu dizesi, hata nesnelerinde DB parametreleri sır taşıyabilir. Nesneyi değil seçilmiş alanları logla.
  - 0.8 açık soruları: kullanıcı token'ı girişte installation senkronu için kullanılacak, ardından iptal edilecek; `installation_id` doğrulaması user token mı App JWT mi olacak, karar ADR-0002'ye.

### 0.8 Installation ve repolar

- Setup dönüşündeki `installation_id`'ye güvenilmiyor: `GET /api/github/setup` hiçbir şey yazmıyor, tarayıcıyı yeniden girişe yolluyor. App'i zaten yetkilendirmiş kullanıcı için bu tur ekran göstermeden geçiyor. Kurulumlar callback'te kullanıcının kendi token'ıyla `GET /user/installations`'tan alınıp tek transaction'da senkronlanıyor (upsert, başkasının satırına dokunmadan; GitHub'da görünmeyen ve app'i olmayan satırlar siliniyor). App JWT ile doğrulama elendi, çünkü organizasyon kurulumunda kullanıcının yetkisini göstermiyor (ADR-0002).
- Kullanıcı token'ı yalnızca `withUser` bloğunda yaşıyor ve blok nasıl biterse bitsin `finally`'de GitHub'da iptal ediliyor; oturum iptalden sonra açılıyor. App JWT `node:crypto` ile RS256 (`iat` −60 sn, toplam ≤ 10 dk); özel anahtar açılışta ayrıştırılıyor, compose'da secret olarak bağlanıyor. Installation token'ları süreç belleğinde, bitişe 5 dk kalana kadar tutuluyor; eşzamanlı istekler tek token isteğini paylaşıyor; token yalnızca `metadata: read` yetkili.
- Uçlar: kurulum listesi + kurulum linki, repolar, dallar. Oturum yoksa 401, başkasınınsa 403, yoksa 404, askıdaysa 409, GitHub hatasında 502 `upstream_failed`. İmleç GitHub sayfa numarası, en fazla 999. Uçtan uca gerçek GitHub ile denendi; JWT `GET /app` ile doğrulandı.
- İnceleme iki gerçek hata buldu, ikisi de gerçek ortamda doğrulanıp düzeltildi: installation token kuruluma eklenmemiş public repoları da okuyabiliyor (`GET /repositories/:id` 200 dönüyordu), artık erişim kurulumun kendi repo listesinden kontrol ediliyor; ortak kurulumları farklı sırada senkronlayan iki giriş deadlock'a (40P01) düşüyordu, liste artık sıralanıyor.
- **Kırılgan noktalar:**
  - GitHub'da erişimini kaybeden kullanıcının app'li kurulum satırı silinmiyor ve repoları görmeye devam ediyor; webhook bunu çözmez (kurulum kaldırılmıyor). Faz 1'de app'ler gelince "erişim kaybedildi" işareti düşünülecek.
  - `POST /api/apps` (Faz 1) senkronla aynı anda çalışırsa RESTRICT hatası girişi 500'e düşürebilir; o zaman test edilmeli. App oluşturma da repo erişimini `findInstalledRepo` ile kontrol etmeli, ID ile doğrudan sorgu yetmez.
  - Kurulum bilgisi yalnızca giriş anındaki kadar güncel; askıya alma/kaldırma bir sonraki girişe kadar görünmüyor (uçlar 409/404 dönüyor). Webhook senkronu 1.2'de.
  - Faz kapanışında ROADMAP §10 durum kodlarına 502 `upstream_failed` ve askıdaki kurulum için 409 eklenecek (onaylandı).

### 0.9 Panel iskeleti

- Panel React + Vite + TanStack Query + Tailwind ile kuruldu; router React Router (declarative mode), testler Vitest + jsdom + Testing Library (ADR-0019). Oturum kapısı router'ın dışında: `App` önce `/api/me`'ye bakıyor, 401'de hangi yolda olunursa olunsun giriş sayfası çıkıyor. Giriş hatası `?login_error=` sorgusundan okunuyor, yalnızca bilinen kodlar gösteriliyor.
- İstekler panelle aynı origin'e gidiyor (Traefik `/api`'yi API'ye yönlendiriyor), bu yüzden CORS ve yeni env değişkeni yok; çıkıştaki POST'ta Origin kontrolünü tarayıcının kendi başlığı geçiyor. Her cevap `@liman/shared` şemasıyla doğrulanıyor; Vite shared'ı `liman-source` koşuluyla kaynaktan paketliyor. Kurulum yoksa `installUrl`'ye giden "Install on GitHub" ekranı, varsa kurulum başına "Load more"lu repo listesi var; askıdaki kurulum için repo isteği hiç atılmıyor.
- İnceleme iki gerçek hata buldu, ikisi de düzeltildi: compose `watch` shared'ı web konteynerine taşımıyordu; arka planda yenileme hata verince yüklü liste hata kutusuyla değişiyordu (artık liste kalıyor, üstte uyarı çıkıyor; yeniden bağlanınca otomatik yenileme kapalı). Ayrıca 401 ve çıkışta önce havadaki istekler iptal ediliyor, sonra önbellek temizleniyor; geç gelen bir `/api/me` kullanıcıyı geri getiremiyor (bunu bir race testi doğruluyor).
- **Kırılgan noktalar:**
  - Clickjacking koruması yok: kardeş subdomain'deki bir uygulama paneli iframe'e koyup tıklatabilir, Origin kontrolü bunu durdurmaz. 0.9'da tek düğme "Sign out"; Faz 1'deki ilk durum değiştiren düğmeyle `frame-ancestors 'none'` gelmeli (park alanında).
  - HMR istemci portu 80'e sabit; Vite host'ta doğrudan çalıştırılınca `/api` erişilemez, panel compose stack'iyle geliştiriliyor.
  - `apiErrorSchema` katı enum: API, shared'dan önce yeni bir hata kodu dönerse panel mesajı okuyamaz ve genel hata gösterir. Şemalar birlikte güncellenmeli.
  - Repo sayfalaması GitHub'ın offset sayfalaması; sayfalar arasında kayma olabilir, panel id'ye göre tekilleştiriyor ama bir repo arada kaybolabilir.

### 0.10 CI

- `.github/workflows/ci.yml` iki job çalıştırıyor. `check`: frozen-lockfile ile kurulum (pnpm önbellekli), lint, typecheck, format:check, bütün testler (Testcontainers dahil; Ubuntu runner'da Docker hazır) ve build. `audit`: `pnpm audit --prod --audit-level high`, ayrıca haftalık. Token salt okunur, action'lar commit SHA'sıyla sabitli; repo ayarında yalnızca GitHub'ın action'ları ve `pnpm/action-setup` izinli, SHA pin zorunlu, fork PR'ları onay bekliyor (ADR-0020).
- main dal koruması: PR zorunlu (onay 0), `check` ve `audit` GitHub Actions uygulamasına bağlı zorunlu check'ler, strict, adminlere de uygulanıyor, force push ve silme kapalı. Kasıtlı kırık bir testle denendi: CI kırmızı → PR `BLOCKED`, geri alınınca `CLEAN`.
- İnceleme bir gerçek hata buldu: concurrency main'deki çalışmaları da iptal ediyordu, art arda iki merge'de ilk commit hiç yeşil görmezdi. Artık PR'da eski çalışma iptal ediliyor, main'de her commit kendi grubunda (`github.sha`) çalışıyor. `passWithNoTests` kaldırıldı; test bulamayan proje artık kırmızı. Skill'ler CI'ı bekleyip `BEHIND`'da dalı güncelliyor, faz etiketi yalnızca CI'ı yeşil commit'e atılıyor.
- **Kırılgan noktalar:**
  - Bir PR kendi `ci.yml`'ini çalıştırır; workflow'u değiştirip zorunlu check'leri boşa çıkarabilir. Tek savunma `.github/` değişikliklerini merge'den önce elle okumak.
  - `audit` npm'in advisory servisine bağlı; servis kesilirse bütün merge'ler bloklanır. Kodla ilgisiz yeni bir açık da PR'ı kırmızıya düşürebilir; istisna `--ignore` ile ve gerekçesi `ci.yml`'ye yazılarak verilir.
  - Job adları (`check`, `audit`) dal korumasında birebir geçiyor; değişirse koruma da güncellenmeli. İzin listesinde olmayan yeni bir action önce repo ayarına eklenmeli.
  - Strict yüzünden main ilerleyince açık PR'lar `BEHIND` olur ve CI yeniden çalışır.

### 0.11 Dokümantasyon

- ADR-0001 (monorepo ve teknoloji seçimi) yazıldı; 0.1–0.3'te verilen ama kayda geçmemiş kararları topluyor: pnpm workspaces, sabit sürümler, `liman-source` koşulu, tek lint/test yapılandırması, Express 5, tek geliştirme imajı ve `compose watch`, iki ağ. ADR-0002, 0003, 0018–0020 zaten alt bölümlerinde yazılmıştı.
- README iskeleti tamamlandı: CI rozeti, "How it works", faz durumu tablosu, Uygulama Sözleşmesi (Bölüm 3 README'de de olmalı) ve doküman linkleri. Mimari şema, ekran görüntüleri ve ölçümler Faz 1'deki README v1'e kaldı.
- 0.1–0.3 için eksik olan taslak notlar git geçmişinden ve PR özetlerinden yazıldı. Faz 0 bölümünün derlenmesi `/faz-kapat 0`'a bırakıldı; skill zaten taslakları faz bölümüne işleyip siliyor.
- İnceleme, dokümanları kodla karşılaştırırken iki gerçek hata buldu ve ikisi de bu dalda düzeltildi: `.npmrc`'deki `engine-strict` pnpm 12'de etkisizdi (artık `pnpm-workspace.yaml`'da `engineStrict`), api'nin `watch` listesinde `packages/db/src` yoktu. Güvenlik denetimi Traefik panelinin konteyner ağında açık olduğunu gösterdi; Faz 1 için park alanına eklendi.
- **Kırılgan noktalar:**
  - Geliştirme imajı `.npmrc` olmadan bu oturumda derlenemedi (Docker Desktop kapalıydı) ve CI bu imajı derlemiyor; `pnpm stack:up` ile elle denenmeli.
  - README'deki faz tablosu elle güncelleniyor; faz kapanışlarında unutulmamalı.
  - README'deki Uygulama Sözleşmesi ROADMAP Bölüm 3'ün kopyası; biri değişirse diğeri de değişmeli.
