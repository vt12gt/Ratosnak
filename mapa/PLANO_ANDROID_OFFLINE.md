# Navega PE — plano da versão Android offline

## Objetivo
Transformar o protótipo web em um aplicativo Android nativo que continue mostrando o mapa e calculando rotas mesmo sem conexão. O protótipo `mapa/index.html` permanece disponível para demonstração online.

## Arquitetura escolhida
- **Mapa:** MapLibre Native Android (Kotlin). A biblioteca oferece armazenamento de regiões offline; cada pacote de mapa deve incluir estilo, tiles e recursos necessários.
- **Rotas:** Valhalla executado localmente no aparelho, usando tiles regionais baixados e instalados no armazenamento privado do app.
- **GPS e navegação:** localização Android, acompanhamento da posição, recálculo de rota e instruções faladas em português.
- **Downloads:** catálogo versionado, download retomável, verificação SHA-256, extração segura, espaço livre estimado e atualização/remoção de regiões.
- **Primeira região:** Pernambuco; depois estados vizinhos (PB, AL, CE e BA), selecionados conforme a viagem.

## Fonte de dados de roteamento identificada
Foi encontrado o projeto público Andorinha, que publica tiles de roteamento Valhalla para o Brasil por estado, derivados do OpenStreetMap. O catálogo consultado em 14/11/2026 informa:
- Geração: `2026-11-09-c17dff60`.
- Versão indicada no catálogo: Valhalla `3.9.1`.
- Pacote base Brasil: aproximadamente 52,8 MB compactado.
- Pernambuco: aproximadamente 65,9 MB compactado.
- Os dois juntos: aproximadamente 118,7 MB compactados, antes de considerar espaço de extração.

**Atenção de compatibilidade:** o README do Andorinha ainda descreve compatibilidade com `valhalla-mobile 0.6.x` / Valhalla 3.6.3, enquanto o catálogo mais recente consultado já declara Valhalla 3.9.1. Não devemos baixar nem integrar esses pacotes no app até confirmar que o motor Android consegue ler exatamente essa geração. Misturar versões pode impedir o roteamento ou causar falhas.

## Mapas visuais offline
Os tiles de roteamento acima NÃO são os mapas visuais. O app também precisará de um provedor de mapas vetoriais com licença e política que permitam download regional. Não será feito download em massa dos servidores públicos padrão de tiles do OpenStreetMap. O MapLibre Native suporta regiões offline, mas o estilo e a fonte de tiles precisam autorizar esse uso.

## Etapas de implementação
1. Criar projeto Android Kotlin e pipeline GitHub Actions para gerar APK de teste.
2. Exibir Recife em mapa nativo MapLibre e confirmar funcionamento no aparelho.
3. Implementar catálogo e gerenciador de mapas visuais offline.
4. Fechar compatibilidade do Valhalla Android com os tiles publicados; se necessário, fixar uma geração compatível ou gerar nossos próprios tiles.
5. Implementar download, verificação SHA-256, extração e gestão dos pacotes de roteamento.
6. Integrar rota offline para carro, moto, bicicleta e pedestre; validar caminhão separadamente.
7. Adicionar navegação curva a curva, voz, retorno à rota e testes sem internet.
8. Expandir cobertura para outros estados e melhorar dados de restrições, trânsito e acessibilidade.

## Regras de segurança e qualidade
- Nunca anunciar uma região como offline antes de testar mapa e rota com o aparelho em modo avião.
- Exibir data da atualização dos dados e atribuição © colaboradores do OpenStreetMap.
- Conferir checksum, versão do motor e identificador da geração antes de instalar tiles.
- Não prometer trânsito ao vivo sem conexão.
- Não prometer acessibilidade sem dados confiáveis de calçadas, rampas, travessias e barreiras.
- Manter o protótipo web funcionando enquanto o aplicativo nativo evolui.

## Referências técnicas
- MapLibre Native Android: https://maplibre.org/maplibre-native/android/api/
- MapLibre offline regions: https://maplibre.org/maplibre-compose/offline/
- Valhalla: https://github.com/valhalla/valhalla
- Andorinha (tiles brasileiros): https://github.com/Murkiriel/andorinha
- Valhalla Mobile: https://github.com/Rallista/valhalla-mobile
