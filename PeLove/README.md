# PeLove ♥
Aplicativo de relacionamentos para maiores de 18 anos, com interface mobile e API online.

## Acessar
- Aplicativo: https://vt12gt.github.io/Ratosnak/PeLove/
- Código: https://github.com/vt12gt/Ratosnak/tree/main/PeLove
- API: https://pelove-api.juniorgmj69.workers.dev/api/health

## Recursos implementados
- Cadastro e login com e-mail e senha.
- Restrição de idade no cadastro e edição de perfil (18+).
- Perfis com nome, idade, gênero, preferência, cidade, bio e foto por URL HTTPS.
- Descoberta de outros perfis cadastrados.
- Curtidas e match recíproco.
- Lista de matches e chat persistido no banco de dados.
- Bloqueio de usuários e envio de denúncias.
- Sessões com token, senha derivada com PBKDF2 e dados persistidos no Cloudflare D1.
- Interface responsiva para Android.

## Infraestrutura
- Front-end estático publicado pelo GitHub Pages.
- API no Cloudflare Workers (pelove-api).
- Banco Cloudflare D1 (pelove-production).

## Importante antes de abrir ao público
Esta é uma primeira versão conectada e funcional, mas ainda não deve ser tratada como lançamento comercial pronto. Ainda faltam: verificação de e-mail, recuperação de senha, upload próprio de fotos (atualmente é link HTTPS), painel de moderação para revisar denúncias, limitação anti-spam/anti-abuso, política de privacidade/termos formais e testes de segurança independentes. O bloqueio e a denúncia já estão disponíveis no aplicativo, mas denúncias ainda precisam ser analisadas por uma equipe.
