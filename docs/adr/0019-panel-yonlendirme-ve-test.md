# 0019 — Panel: yönlendirme, API istemcisi ve test ortamı

- Durum: Kabul edildi
- Tarih: 2026-11-26
- Faz: 0

## Bağlam

0.9'da panelin iskeleti kuruldu. Bölüm 4 yığını belirliyor (React + Vite + TanStack Query + Tailwind), ama üç konu açık kalıyordu:

1. Yönlendirme (router) için hangi kütüphane kullanılacak, yoksa hiç router olmayacak mı? 0.9'da yalnızca iki ekran var (giriş ve ana sayfa). Faz 1'de uygulama, build ve deployment detay sayfaları geliyor.
2. Panel API'ye nasıl istek atacak, cevaplar nasıl doğrulanacak?
3. Bileşen testleri hangi DOM ortamında çalışacak?

## Karar

- **React Router (declarative mode).** `BrowserRouter` + `<Routes>` kullanılıyor; veri yükleyici (loader) ya da framework modu yok, veri TanStack Query'den geliyor. Oturum kapısı router'ın dışında: `App` önce `GET /api/me`'ye bakıyor; 401 gelirse hangi yolda olunursa olunsun giriş sayfası gösteriliyor, oturum varsa rotalar açılıyor. Giriş hatası API'nin yönlendirdiği `/?login_error=<kod>` sorgusundan okunuyor ve yalnızca `@liman/shared`'daki bilinen kodlar gösteriliyor.
- **İnce bir `fetch` sarmalayıcısı.** İstekler panelle aynı origin'e gidiyor (Traefik `/api`'yi API'ye yönlendiriyor). Bu yüzden CORS ya da yeni bir env değişkeni yok, çerez kendiliğinden gidiyor ve durum değiştiren isteklerde `Origin` kontrolünü tarayıcının gönderdiği başlık geçiyor. Her cevap `@liman/shared` içindeki Zod şemasıyla doğrulanıyor, hata gövdesi `ApiRequestError`'a (`status` + `code`) çevriliyor. Herhangi bir istekte 401 gelirse önbellekteki kullanıcı `null` yapılıyor ve panel giriş sayfasına dönüyor. 4xx hataları yeniden denenmiyor, ağ hataları ve 5xx en fazla iki kez deneniyor.
- **Paylaşılan kod kaynaktan.** Vite, `liman-source` koşuluyla `@liman/shared`'ı TypeScript kaynağından paketliyor (api ve worker'daki gibi). Panelin build'i (`vite build`) shared'ın önce derlenmesini beklemiyor.
- **Test: Vitest + jsdom + Testing Library.** Testler bütün paneli `MemoryRouter` içinde render ediyor; `fetch`, `METHOD yol` anahtarlı bir sahteyle değiştiriliyor.

## Elenen alternatifler

- **TanStack Router.** Tip güvenli yollar ve arama parametreleri güzel, ama Vite eklentisi ve dosya tabanlı kod üretimi ekliyor. Bir avuç sayfalık bir panel için gereğinden ağır.
- **Router hiç olmaması.** 0.9 için yeterdi, ama Faz 1'de detay sayfaları gelince yine eklemek gerekecekti. Sonradan eklemek bütün sayfa yapısını değiştirirdi.
- **React Router framework/data modu.** Loader'lar TanStack Query ile aynı işi yapıyor; iki veri katmanı olurdu.
- **OpenAPI'den üretilmiş istemci.** API'de OpenAPI tanımı yok. Şemalar zaten `@liman/shared`'da ortak, aynı şemayla doğrulamak yeterli.
- **happy-dom.** Daha hızlı ama bazı DOM API'leri eksik. Test sayısı az olduğu için hız farkı önemsiz.
- **Playwright ile tarayıcı testleri.** Gerçek tarayıcı gerektiriyor, CI'yı yavaşlatıyor. Uçtan uca doğrulama Bölüm 14'teki betikle yapılacak.

## Sonuçlar

- Faz 1'deki yeni sayfalar `<Route>` olarak `Layout`'un altına ekleniyor. Oturum kapısı onları kendiliğinden koruyor.
- Panelde 401 tek bir yerde ele alınıyor (`queryClient.ts`). Yeni bir sorgu ya da mutation ayrıca 401 kontrolü yazmak zorunda değil.
- Cevap şeması API ile uyuşmazsa panel bunu bir hata olarak gösteriyor, sessizce yanlış veriyle çalışmıyor. Şema `@liman/shared`'da değişince iki taraf birlikte güncellenmeli.
- Dev sunucusuna tarayıcı Traefik üzerinden (80) bağlandığı için HMR istemci portu 80'e sabitlendi. Vite'ı host'ta doğrudan çalıştırınca `/api` erişilemez; panel compose stack'iyle geliştiriliyor.
- jsdom gerçek tarayıcı değil: yerleşim ve CSS test edilmiyor, yalnızca davranış test ediliyor.
