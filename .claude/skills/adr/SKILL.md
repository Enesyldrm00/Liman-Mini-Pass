---
name: adr
description: docs/adr altında Türkçe bir ADR yazar (Bağlam, Karar, Elenen alternatifler, Sonuçlar). Numarayı ROADMAP Bölüm 17'deki listeye göre seçer.
argument-hint: "[başlık]"
disable-model-invocation: true
---

# ADR: $ARGUMENTS

ADR'ler Türkçe yazılır. Dosya adı İngilizce değil, başlığın kebab-case Türkçe karşılığıdır (ASCII, ör. `0002-oauth-app-yerine-github-app.md`).

## 1. Numara

- `docs/ROADMAP.md` Bölüm 17'deki tabloyu ve `docs/adr/` içindeki mevcut dosyaları oku.
- Başlık tablodaki bir ADR'ye karşılık geliyorsa **o numarayı** kullan.
- Karşılık gelmiyorsa mevcut dosyalardaki ve tablodaki en büyük numaranın bir fazlasını kullan (0018+). Enes'i uyar: "Bu ADR planlı değil." Onay almadan yazma.
- Numara zaten kullanılıyorsa dur ve sor.

## 2. İçerik

Kararın dayanağını konuşmadan, koddan ve ROADMAP'ten al. Uydurma; bilinmeyen bir nokta varsa Enes'e sor.

```markdown
# NNNN — <Başlık>

- Durum: Kabul edildi
- Tarih: <YYYY-MM-DD>
- Faz: <N>

## Bağlam

Hangi problem, hangi kısıtlar.

## Karar

Ne seçtik, kısa ve net.

## Elenen alternatifler

- **<Alternatif>:** neden elendi.

## Sonuçlar

Kazanımlar, bedeller, kabul edilen riskler, ileride neyi değiştirebilir.
```

## 3. Bitir

- Dosyayı mevcut alt bölüm dalına yaz (main'de değil).
- Commit mesajı öner: `docs: add ADR-NNNN <kısa İngilizce başlık>`.
- Kararı sohbette 2–3 cümleyle sade Türkçe özetle.
