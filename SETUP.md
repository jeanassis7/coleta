# JJHS Coleta — Guia de Setup

Passo a passo do zero pra subir o app em produção em uma conta nova.
**Tempo total: 20-30 minutos.**

---

## 0. Pré-requisitos no seu computador

- **Node.js 20 ou maior** — https://nodejs.org (baixe a versão "LTS")
- **Conta no GitHub** (gratuita) — https://github.com/signup
- **Git** instalado — https://git-scm.com/downloads (se ainda não tiver)

Pra testar se Node está instalado, abre o PowerShell e roda:

```powershell
node --version
npm --version
```

Se aparecer um número (ex: `v20.10.0`), tá pronto.

---

## 1. Criar o projeto Supabase

1. Vai em https://supabase.com → **Start your project** → entra com email/Google.
2. Clica em **New project**.
3. Preenche:
   - **Project name:** `jjhs-coleta`
   - **Database password:** gera uma forte (clica em "Generate a password") e **salva em lugar seguro** (gerenciador de senhas).
   - **Region:** `South America (São Paulo)` — sa-east-1.
   - **Plan:** Free.
4. Clica em **Create new project** e espera ~2 minutos.

### 1.1 Rodar o schema (migrations)

1. Dentro do projeto criado, no menu lateral, clica em **SQL Editor** (ícone `</>`).
2. Clica em **+ New query**.
3. Abre o arquivo `supabase/migrations/0001_initial.sql` deste projeto, copia **todo** o conteúdo.
4. Cola no SQL Editor.
5. Clica em **RUN** (canto inferior direito).
6. Deve aparecer "Success. No rows returned." — pronto, schema instalado.

### 1.2 Pegar as chaves do projeto

Ainda no Supabase:

1. No menu lateral, clica em **Settings** (engrenagem) → **API**.
2. Você vai ver 3 valores importantes — anota cada um:
   - **Project URL** — ex: `https://abcdefghijkl.supabase.co`
   - **API Keys → `anon` `public`** — chave longa começando com `eyJ...`
   - **API Keys → `service_role` `secret`** — chave longa começando com `eyJ...` (essa é **secreta**, nunca exponha)

### 1.3 Criar o usuário admin (você)

1. Menu lateral → **Authentication** → **Users** → **Add user** → **Create new user**.
2. Email: `jean@jjhs.local` (ou outro de sua escolha — não precisa ser email real)
3. Senha: forte, pelo menos 12 caracteres
4. **Marca** "Auto Confirm User"
5. Clica em **Create user**.
6. Copia o `User UID` que aparece (vai usar no próximo passo).

Agora precisa marcar esse usuário como admin no profile:

1. Menu lateral → **SQL Editor** → **+ New query**.
2. Cola e ajusta com o UID copiado:

   ```sql
   insert into public.profiles (id, nome, role, ativo, exige_foto)
   values (
     'COLE_O_USER_UID_AQUI',
     'Jean',
     'admin',
     true,
     true   -- seu perfil já com foto ativada pra teste
   );
   ```

3. Clica em **RUN**.

Pronto, você já tem login admin.

---

## 2. Configurar o projeto local

Abre o PowerShell na pasta `C:\Users\Evaner\Desktop\JJHS` e roda:

```powershell
cd C:\Users\Evaner\Desktop\JJHS
npm install
```

Isso baixa todas as dependências (~2-5 minutos na primeira vez).

Cria o arquivo `.env.local` (na raiz, mesmo lugar do `package.json`):

```powershell
copy .env.example .env.local
```

Abre o `.env.local` no Notepad ou VSCode e cola os 3 valores que você anotou no passo 1.2:

```env
NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijkl.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...sua-chave-anon...
SUPABASE_SERVICE_ROLE_KEY=eyJ...sua-chave-service-role...
```

Salva.

---

## 3. Rodar localmente pra testar

```powershell
npm run dev
```

Abre o navegador em `http://localhost:3000`.

Vai redirecionar pra `/motorista/login`. Use `/admin/login` no endereço pra entrar como admin (jean@jjhs.local + a senha que você criou).

### Criar os motoristas

1. Logado como admin, vai em **Motoristas** no menu.
2. Clica em **+ Adicionar motorista**:
   - Nome: `Luis` → email auto-gera `luis@jjhs.local`
   - Senha temporária: escolhe uma (mínimo 6 caracteres)
   - Tipo: motorista
3. Repete pra `Lucimar` e `Lucinei`.

### Testar fluxo motorista

1. Abre nova aba anônima → `http://localhost:3000/motorista/login`
2. Loga como `luis@jjhs.local`.
3. Cria uma coleta de teste.
4. Volta na aba admin, recarrega — coleta aparece.

Se chegou aqui, o app **tá funcionando**.

Pra parar: `Ctrl+C` no PowerShell.

---

## 4. Subir pra produção na Vercel

### 4.1 Subir o código pro GitHub

1. Cria um repositório novo: https://github.com/new
   - Nome: `jjhs-coleta`
   - **Private** (importante — código não vaza)
   - **Não** marca nenhuma das opções de README/license
2. Abre o PowerShell na pasta do projeto:

   ```powershell
   cd C:\Users\Evaner\Desktop\JJHS
   git init
   git add .
   git commit -m "primeira versao"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/jjhs-coleta.git
   git push -u origin main
   ```

   Troca `SEU_USUARIO` pelo seu username do GitHub.

   Vai pedir login na primeira vez — usa seu user/senha do GitHub (ou personal access token).

### 4.2 Deploy na Vercel

1. Vai em https://vercel.com/signup → entra com **GitHub** (mais fácil).
2. Após o cadastro, clica em **Add New...** → **Project**.
3. Importa o repositório `jjhs-coleta`.
4. Em **Framework Preset** já vai detectar `Next.js`. Deixa.
5. Expande **Environment Variables** e adiciona as 3 variáveis (cola os mesmos valores do `.env.local`):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
6. Clica em **Deploy**.
7. Espera ~2-3 minutos. Quando ficar verde, clica em **Continue to Dashboard**.

Sua URL fica algo tipo `https://jjhs-coleta-abc123.vercel.app`. **Anota.**

### 4.3 Liberar o domínio no Supabase

O Supabase precisa permitir requisições da sua URL Vercel.

1. Supabase → **Authentication** → **URL Configuration**.
2. Em **Site URL** cola: `https://jjhs-coleta-abc123.vercel.app` (sua URL real).
3. Em **Redirect URLs** adiciona a mesma URL + `/**` no final:
   - `https://jjhs-coleta-abc123.vercel.app/**`
4. Clica em **Save**.

---

## 5. Distribuir pros motoristas

Manda no WhatsApp do Luis, Lucimar e Lucinei algo assim:

> Pessoal, app de coleta tá no ar:
>
> 🔗 https://jjhs-coleta-abc123.vercel.app/motorista
>
> Seu login:
> Email: luis@jjhs.local
> Senha: a-que-eu-mandei
>
> **Importante:** quando abrir pela primeira vez, vai aparecer um botão "INSTALAR" — clica nele pra adicionar o app na tela do celular. Depois só usa pelo ícone JJHS.
>
> Qualquer dúvida me chama.

---

## 6. Operação do dia a dia

### Rollout do toggle de foto

- **Semanas 1-3:** todos com `exige_foto = OFF`. Motoristas focam no fluxo simples.
- **Semana 4:** entra no painel → Motoristas → ativa toggle "Exige foto" em **1 motorista** (canário). Observa por uns 3-4 dias.
- **Semana 5:** ativa nos demais.

### Quando algo der errado

- **Motorista diz "não tá enviando":** painel admin → menu **Eventos** → filtra por aquele motorista. Olha eventos `sync_failure` ou `gps_error` recentes. O payload mostra exatamente o que falhou.
- **GPS não capturando:** Eventos → filtra `gps_*`. Se aparecer `gps_denied`, o motorista negou a permissão e precisa ir nas configurações do celular liberar localização.
- **Reset de senha:** Motoristas → resetar senha do motorista → manda a nova por WhatsApp.

### Backup

Free tier do Supabase faz backup diário automático por 7 dias.
**Importante:** se o negócio crescer, atualiza pro Pro ($25/mês) que dá 7 dias de PITR + backup contínuo.

---

## 7. Quando precisar atualizar o app

```powershell
cd C:\Users\Evaner\Desktop\JJHS
# faz suas mudanças no código
git add .
git commit -m "descreve o que mudou"
git push
```

Vercel automaticamente faz novo deploy. ~2 minutos depois tá no ar. Os motoristas só recebem a atualização ao reabrir o app.

---

## 8. Resolução de problemas comuns

**"Permission denied" ao rodar `git push`**
→ Configura SSH key ou usa Personal Access Token do GitHub (tutorial: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

**Vercel build falha com "Module not found"**
→ Verifica se `npm install` rodou ok local. Se sim, tenta `npm run build` local pra ver o erro completo.

**App instalado fica em branco no celular**
→ Limpa cache do Chrome: configurações do Chrome → Privacidade → Limpar dados → Imagens/arquivos cacheados. Reabre o app.

**"infinite redirect" entre login e home**
→ Verifica se o usuário tem entrada em `profiles` (Supabase → Table Editor → profiles).

**Ícone do PWA aparece cortado/feio**
→ Os SVGs em `public/icons/` funcionam, mas pra qualidade máxima converte pra PNG. Use https://cloudconvert.com/svg-to-png (sobe os 3 SVGs, baixa os 3 PNGs nas dimensões originais, salva em `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` e edita `public/manifest.json` trocando `.svg` por `.png` e `image/svg+xml` por `image/png`).

---

## 9. Custos

V1 — Free tier deve durar **anos**:
- **Supabase Free:** 500MB DB, 1GB storage de fotos, 50k MAU. Com 3 motoristas e fotos de ~50KB cada, isso dá uns 20 mil coletas até encher.
- **Vercel Free (Hobby):** 100GB bandwidth/mês, ilimitado builds. Sobra muito.
- **Domínio custom (opcional):** R$ 40/ano em `coleta.jjhs.com.br`. Aponta no Vercel → Settings → Domains.

Quando crescer:
- Supabase Pro: $25/mês (uns R$ 130).
- Vercel Pro: $20/mês (só se passar de 100GB bandwidth, improvável pra esse uso).

---

Qualquer travada, manda print do erro e me chama.
