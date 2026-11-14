# PeLove ♥ — modo de teste local

Aplicativo de relacionamentos para maiores de 18 anos. A versão atual foi preparada para testes sem depender de servidor ou banco de dados.

## Abrir
https://vt12gt.github.io/Ratosnak/PeLove/

## Recursos no modo local
- Criar conta e entrar com e-mail e senha.
- Validação de idade mínima de 18 anos.
- Perfil com nome, idade, gênero, preferência, cidade e biografia.
- Foto por link HTTPS ou arquivo escolhido no aparelho (até 1,2 MB).
- Descoberta dos outros perfis cadastrados no mesmo navegador.
- Curtidas, matches recíprocos e conversas locais.
- Bloqueio e registro local de denúncias.
- Exportação de backup dos dados locais.
- Interface responsiva para celular.

## Limitação importante
Este modo guarda contas, perfis, curtidas e mensagens no localStorage do navegador. Os dados não são enviados para um servidor, não são sincronizados entre aparelhos e podem ser apagados se os dados do navegador forem limpos. A senha local é apenas para facilitar testes e não deve ser reutilizada em outros serviços. Use apenas dados fictícios durante os testes.

Para testar um match: crie uma conta, saia, crie uma segunda conta no mesmo aparelho e navegador, curta o primeiro perfil e depois entre novamente na primeira conta para curtir o segundo. O match e o chat serão simulados localmente.

## Próxima etapa: ativar o banco de dados
O projeto já tem uma estrutura de API e banco D1 preparada na infraestrutura, mas esta interface está configurada para não chamar o servidor. Antes de abrir ao público, será necessário ligar a interface à API, implementar verificação de e-mail, recuperação de senha, upload de fotos seguro, controles antiabuso, moderação das denúncias, termos e política de privacidade e testes de segurança.
