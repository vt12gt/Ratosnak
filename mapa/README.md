# Navega PE — protótipo 0.1

Aplicativo de navegação experimental iniciado para Recife e Pernambuco.

## Recursos desta versão
- Mapa interativo Leaflet com OpenStreetMap.
- GPS do aparelho e precisão informada pelo sistema.
- Busca de destinos com Nominatim.
- Rotas por Valhalla para carro, moto, caminhão, bicicleta e pedestre.
- Instruções de manobra e voz do navegador.
- Seleção de destino tocando no mapa.
- Favoritos salvos localmente.
- PWA: instalação na tela inicial e cache do app shell.
- Cache oportunista de blocos de mapa já visualizados.

## Testar
Abra a página publicada em HTTPS e permita localização. Para GitHub Pages, configure a publicação a partir da branch main e da pasta raiz, ou publique o diretório /mapa conforme a configuração do repositório.

## Limitações importantes
Esta versão ainda não baixa pacotes completos por cidade/estado e não calcula rotas sem internet. O cache de blocos consultados não é um pacote offline garantido. Busca e roteamento usam serviços públicos de demonstração sujeitos a limites. Para offline verdadeiro, a próxima etapa será um app Android nativo com MapLibre Native, pacotes regionais de mapas e motor de roteamento local (Valhalla). A opção de acessibilidade é experimental e ainda não garante rotas acessíveis. As estimativas não incluem trânsito ao vivo.

Dados cartográficos © OpenStreetMap contributors.
