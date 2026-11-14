# Navega PE — protótipo 0.2

Navegador experimental para Recife e Pernambuco.

## Recursos
- Mapa interativo com dados © OpenStreetMap contributors.
- GPS contínuo e acompanhamento da localização.
- Rotas online para carro, moto, caminhão, bicicleta e pedestre.
- Instruções de manobra e avisos por voz.
- Busca de destinos e escolha de ponto diretamente no mapa.
- Favoritos salvos no aparelho.
- Busca de pontos de referência próximos: hospitais, postos, restaurantes, estacionamentos, farmácias e atrações cadastradas no OpenStreetMap.
- Marcadores de pontos de interesse podem ser escolhidos como destino.
- Interface móvel com mapa em tela cheia e painel recolhível.

## Teste
https://vt12gt.github.io/Ratosnak/mapa/

## Limitações
A busca de pontos próximos usa o serviço Overpass público e pode sofrer limites ou indisponibilidade. A quantidade e qualidade de nomes, números de porta e pontos de interesse depende do cadastro colaborativo do OpenStreetMap. A ausência de um local no resultado não prova que ele não exista.

Esta versão ainda depende de internet para carregar blocos de mapa que não foram vistos, pesquisar destinos, consultar pontos de interesse e calcular rotas. O cache do navegador não representa download offline completo. O roteamento offline e os pacotes regionais fazem parte do aplicativo Android futuro.

O mapa padrão usa exclusivamente o endpoint oficial `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, com atribuição visível. Os servidores padrão do OSM não permitem baixar cidades ou regiões em massa para uso offline; para isso será necessário contratar um provedor que autorize explicitamente o uso offline ou hospedar nossos próprios tiles. Consulte a política oficial: https://operations.osmfoundation.org/policies/tiles/

A opção de acessibilidade ainda é experimental e não garante rotas acessíveis. Estimativas de tempo não incluem trânsito ao vivo.

## Plano Android offline
Consulte [PLANO_ANDROID_OFFLINE.md](./PLANO_ANDROID_OFFLINE.md).

Dados cartográficos © OpenStreetMap contributors.
