# 0002 — OAuth App yerine GitHub App

- Durum: Kabul edildi
- Tarih: 2026-11-26
- Faz: 0

## Bağlam

Liman'ın GitHub'la üç işi var: kullanıcıyı panele almak, seçilen repoları okumak (listelemek, Faz 1'de klonlamak) ve `push` olaylarını almak. GitHub bunun için iki entegrasyon türü sunuyor: OAuth App ve GitHub App.

0.6'da geliştirme App'i (`liman-dev-06`) yalnızca Contents ve Metadata okuma yetkisiyle kuruldu; 0.7'de giriş bu App'in kullanıcı yetkilendirmesiyle yapıldı (ADR-0003). 0.8'de üç soru açıktı:

1. App kurulduktan sonra GitHub, Setup URL'ye `?installation_id=…` ile dönüyor. Bu değere nasıl güvenilir?
2. Repo okumak için gereken App JWT nasıl üretilecek?
3. Installation token'ları (en fazla 1 saat geçerli) nerede önbellekte tutulacak?

Ek kısıtlar: kullanıcı GitHub token'ı saklanmaz (Bölüm 7); installation token loglarda görünmez (Bölüm 13).

## Karar

- **GitHub App.** Kullanıcı girişi, repo erişimi ve webhook'lar aynı App üzerinden yürüyor.
- **Setup dönüşündeki `installation_id`'ye güvenilmez.** `GET /api/github/setup` hiçbir şey yazmaz; tarayıcıyı `/api/auth/github/login`'e yönlendirir. Bu değer yalnızca ipucu olarak loglanır. App'i zaten yetkilendirmiş bir kullanıcı için GitHub yetkilendirme ekranını göstermeden hemen callback'e döner. Callback, kullanıcının kendi token'ıyla `GET /user/installations` çağırır ve `github_installations` tablosunu GitHub'ın verdiği listeyle eşitler. Böylece setup dönüşü ve giriş aynı kod yolunu kullanır.
- **Senkron kuralları** (`syncInstallations`, tek transaction):
  - GitHub'ın verdiği kurulumlar upsert edilir; kurulumun hesap adı ve askıya alınma durumu güncellenir.
  - Başka bir Liman kullanıcısına ait bir satırın sahipliği değişmez (`ON CONFLICT … DO UPDATE … WHERE owner_id = …`).
  - Kullanıcının GitHub'da artık görünmeyen kurulumları silinir. O kuruluma bağlı bir app varsa satıra dokunulmaz, çünkü `apps.installation_ref` RESTRICT (bkz. Sonuçlar'daki kabul edilen risk).
  - Liste önce `installation_id`'ye göre tekilleştirilir ve sıralanır. Ortak kurulumları farklı sırada senkronlayan iki giriş satırları ters sırada kilitleyip deadlock'a (40P01) düşüyordu; bu bir testle yeniden üretildi.
  - Liste kısmi kalmasın diye sayfaların hepsi okunur; 10 sayfayı (1000 kurulum) aşarsa giriş hata verir. Kısmi bir liste, görülmeyen kurulumların silinmesine yol açardı.
  - GitHub'dan liste alınamazsa DB'ye hiçbir şey yazılmaz ve oturum açılmaz.
- **Kullanıcı token'ı tek bir blokta yaşar.** `GitHubAuth.withUser(params, use)` code'u token'a çevirir, kullanıcıyı alır ve `use`'u çalıştırır. `use` ister başarılı bitsin ister hata atsın, sonunda token `DELETE /applications/{client_id}/token` ile GitHub'da iptal edilir. Token modülün dışına hiç çıkmaz, oturum ancak iptalden sonra açılır. İptal başarısız olursa giriş yine tamamlanır ve yalnızca sebebi loglanır (token zaten 8 saatte kendiliğinden düşer). İzin listesinde olmayan bir hesabın kurulumları hiç sorgulanmaz.
- **App JWT'yi kendimiz üretiyoruz:** `node:crypto` ile RS256 imzası. `iat` saat kaymasına karşı 60 sn geriye alınır, `exp` = şimdi + 9 dk (toplam pencere ≤ 10 dk). `iss` App ID'dir. Özel anahtar açılışta okunur ve `createPrivateKey` ile ayrıştırılır; dosya yoksa ya da RSA özel anahtarı değilse API başlamaz. Compose'da anahtar `secrets:` ile `/run/secrets/github_app_key` olarak bağlanır, imaja girmez.
- **Installation token'ları süreç belleğinde tutulur.** Önbellek kurulum başına tek token saklar ve token'ın bitmesine 5 dakikadan az kaldıysa yenisini alır. Aynı anda gelen istekler tek bir token isteğini paylaşır. Hatalar önbelleğe girmez. GitHub bir token'ı 401 ile reddederse token önbellekten atılır ve sonraki istek yeni token alır. API token'ı yalnızca `metadata: read` yetkisiyle ister: repo ve dal listelemek için bu yeterli (gerçek GitHub'da doğrulandı), kod okunamaz. Faz 1'de worker klon için kendi token'ını `contents: read` ile alacak.
- **Uçlar:** `GET /api/github/installations` (kurulumlar ve `https://github.com/apps/<slug>/installations/new` linki), `…/:id/repos` ve `…/:id/repos/:repoId/branches`. `:id`, Liman'ın UUID'si. Kurulum yoksa 404, başkasınınsa 403, askıdaysa 409 döner (Liman'daki satır henüz askıda görünmese bile, GitHub token isteğine 403 verirse yine 409).
  - **Repo erişim kontrolü kurulumun kendi listesinden yapılır** (`findInstalledRepo`): `GET /installation/repositories` sayfaları en fazla 10 sayfa (1000 repo) taranır, aşılırsa 409. `GET /repositories/:id` bunun yerine kullanılamaz: installation token herhangi bir public repoyu okuyabiliyor ve kuruluma eklenmemiş bir public repo için de 200 dönüyor (gerçek GitHub'da doğrulandı; güvenlik denetiminin bulgusu). Faz 1'de app oluşturma da bu kontrolü kullanmalı.
  - Sayfalama imleç tabanlı (Bölüm 10); imleç bugün GitHub'ın sayfa numarası ve en fazla 999, son adreslenebilir sayfada `nextCursor` boş döner. GitHub hata verirse 502 `upstream_failed` döner; kurulum GitHub'da kaldırılmışsa 404. 502 ve askıdaki kurulum için 409, Bölüm 10'daki listeye faz kapanışında eklenir.

## Elenen alternatifler

- **OAuth App:** Erişim kullanıcı token'ıyla olur ve `repo` kapsamı kullanıcının bütün repolarına okuma-yazma verir. Repo seçimi yapılamaz, token'ın da saklanması gerekirdi. Webhook'lar her repoya ayrı ayrı kurulmak zorunda kalırdı.
- **`installation_id`'yi App JWT ile doğrulamak** (`GET /app/installations/:id` ve `account.id` ile kullanıcının GitHub ID'sini karşılaştırmak): Tek çağrı ve yönlendirme yok. Ama yalnızca kişisel hesaba kurulumda işe yarar; organizasyona kurulumda `account` organizasyondur ve kullanıcının orada yetkisi olup olmadığı bu çağrıdan anlaşılmaz.
- **Kullanıcı token'ını saklayıp setup'ta kullanmak:** Bölüm 7'ye aykırı; uzun yaşayan bir sır olur.
- **"Request user authorization during installation" ayarını açmak:** GitHub bu durumda Setup URL'yi devre dışı bırakıp kullanıcıyı doğrudan callback'e gönderiyor. Aynı sonuca ulaşırdı, ama callback'i bizim başlatmadığımız bir akışa açardı; bu akışta `state` çerezi ve PKCE verifier olmazdı ve callback bu yüzden isteği reddederdi (ADR-0003). Setup → giriş yönlendirmesi `state`/PKCE korumasını aynen koruyor ve "Redirect on update" ile repo seçimi değişiklikleri için de çalışıyor.
- **`@octokit/auth-app`:** Hazır ve test edilmiş bir kütüphane, ama bağımlılık ağacı büyük ve önbellek/JWT davranışı kapalı kutu kalıyor. Kendi kodumuz ~30 satır, testleri var, mülakatta adım adım anlatılabilir.
- **Token önbelleği Redis'te:** API ile worker'ın ortak kullanımı sağlanır ve GitHub'a biraz daha az istek gider. Karşılığında 1 saat geçerli bir sır Redis'te düz metin olarak durur. Token almak ucuz; risk buna değmez.
- **Repoları tek seferde hepsini döndürmek:** Panel için basit olurdu, ama Bölüm 10 imleç tabanlı sayfalama istiyor ve büyük hesaplarda istek süresi sınırsız uzardı.

## Sonuçlar

- Her setup dönüşü bir giriş turu demek; hız sınırı (dakikada 10) bunu da sayar ve tarayıcıdaki oturum yenilenir.
- Kurulum bilgisi yalnızca giriş anındaki kadar günceldir. App kaldırılırsa ya da askıya alınırsa bunu bir sonraki girişe kadar bilemeyiz; o arada repo uçları 404/409/502 döner. Webhook ile anlık senkron Faz 1.2'de gelir.
- Token önbelleği süreç başına; API yeniden başlarsa ilk istekte yeni token alınır. Önbellek boyutu kurulum sayısıyla sınırlı, tek kullanıcılı kurulumda küçük.
- **Kabul edilen risk:** İptal başarısız olursa kullanıcı token'ı GitHub'da en fazla 8 saat geçerli kalır. Token hiçbir yere yazılmadığı için risk düşük.
- **Kabul edilen risk:** Bir organizasyon kurulumunu iki izinli kullanıcı görebiliyorsa satır ilk senkron edenin olur; ikincisi o kurulumu panelde görmez. Installation token kullanıcının değil kurulumun yetkisini taşıdığı için, satırı alan kişi kurulumdaki bütün repoları görür; GitHub'da yalnızca birkaçına erişimi olsa bile. Liman tek sahipli (Bölüm 2), şimdilik yeterli.
- **Kabul edilen risk:** GitHub'daki erişimini kaybeden (ör. organizasyondan çıkarılan) bir kullanıcının, app bağlı olduğu için silinmeyen kurulum satırı durur ve kullanıcı o kurulumun repolarını Liman üzerinden görmeye devam eder. Kurulum kaldırılmadığı için GitHub `installation` webhook'u göndermez; Faz 1.2 bunu çözmez. Bugün hiç app yok ve Liman tek sahipli. Faz 1'de app'ler gelince satıra "erişim kaybedildi" işareti (şema değişikliği ve ADR) yeniden değerlendirilir.
- **Faz 1 için not:** Senkrondaki silme, READ COMMITTED altında henüz commit edilmemiş bir `apps` insert'ini göremez; aynı anda app oluşturulursa RESTRICT hatası tüm senkronu geri alır ve giriş 500 olur. Veri bozulmaz. `POST /api/apps` geldiğinde bu etkileşim test edilir.
- Testler: JWT imzası ve süreleri, token önbelleği (yeniden kullanma, süre dolmadan yenileme, tek istek paylaşma, hatanın önbelleğe girmemesi), `withUser`'ın her durumda token'ı iptal etmesi, senkron kuralları ve sayaçları, eşzamanlı senkronda deadlock olmaması, uçların sahiplik kontrolleri ve kurulum dışındaki public repo için 404. Uç testlerinde gerçek App istemcisi kullanılıyor, sahte GitHub JWT imzasını doğruluyor ve testler token'ın loglarda geçmediğini kontrol ediyor.
