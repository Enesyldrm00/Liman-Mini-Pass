---
name: acikla
description: Bir dosyayı, fonksiyonu ya da konuyu mülakatta anlatılabilecek seviyede sade Türkçeyle açıklar. Kod değiştirmez.
argument-hint: "[dosya | fonksiyon | konu]"
disable-model-invocation: true
disallowed-tools: Edit, Write, NotebookEdit
---

# Açıkla: $ARGUMENTS

Bu skill **hiçbir dosyayı değiştirmez**, commit atmaz.

## 1. Oku

- `$ARGUMENTS` bir dosyaysa dosyayı oku. Fonksiyon ya da konuysa Grep ile ilgili kodu bul.
- İlgili ROADMAP bölümünü (ör. 7, 8, 9, 11, 13) ve `docs/adr/` içindeki ilgili ADR'yi oku.
- Henüz yazılmamış bir şeyse bunu söyle. ROADMAP'teki tasarımı anlat, uydurma.

## 2. Anlat

Samimi, sade Türkçe. Kısa paragraflar. Kod parçalarını `dosya:satır` referansıyla göster.

1. **Ne yapıyor?** Tek cümlelik özet, sonra adım adım akış.
2. **Neden böyle?** Hangi problemi çözüyor, hangi ROADMAP kuralına veya ADR'ye dayanıyor.
3. **Elenen alternatifler:** Neler düşünülebilirdi, neden seçilmedi.
4. **Nerede kırılabilir?** Uç durumlar, yarışlar, hata senaryoları ve bunları yakalayan testler.
5. **Mülakat sorusu:** Bu konuda sorulabilecek 2–3 soru ve kısa cevapları.

Sonunda Enes'e "Daha derine inmek istediğin bir yer var mı?" diye sor.
