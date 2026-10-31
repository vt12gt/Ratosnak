# Rato Snack — projeto Android (teste)

Esta ramificação adiciona um invólucro Android nativo. O HTML original e os ícones da raiz são copiados para os assets do APK durante a compilação; nenhum arquivo original é alterado.

- Orientação paisagem e tela imersiva.
- WebView interno; não abre Chrome.
- Sem permissão INTERNET no manifesto.
- JavaScript, DOM Storage e IndexedDB habilitados para o jogo local.

## Compilar
Abra Actions > Build Rato Snack APK > Run workflow nesta branch. Baixe o artefato Rato-Snack-APK-teste.

Este primeiro artefato é um APK debug para testes, não uma versão assinada para Google Play. O jogo ainda precisa ser validado em aparelho real, especialmente salvamento, áudio e controles.
