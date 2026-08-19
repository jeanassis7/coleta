-- 0023 — Fim do papel `dev`: quem era dev vira admin.
--
-- ---------------------------------------------------------------------------
-- POR QUE ESTA MIGRATION RODA ANTES DO DEPLOY DO CÓDIGO NOVO
-- ---------------------------------------------------------------------------
-- O código que está em produção agora usa `podeAcessarAdmin`, que aceita
-- admin OU dev. Então virar admin aqui é invisível pra ele — nada muda.
--
-- O código novo aceita SÓ admin. Se ele subisse primeiro, o Evaner perderia
-- o painel no instante do deploy e só voltaria por SQL.
--
-- Ordem correta, portanto: esta migration → deploy → migration 0024.
--
-- ---------------------------------------------------------------------------
-- O QUE SOBRA COMO DIFERENÇA
-- ---------------------------------------------------------------------------
-- Só a coluna `ve_log` (criada na 0022), que já está `true` pro Evaner e
-- `false` pro Jean. Decisão do Evaner em 19/08/2026: capacidade extra vira
-- COLUNA no cadastro, nunca papel novo. O papel `dev` existia enquanto o
-- Módulo 1 era invisível pro Jean; depois do flip virou hierarquia sem função.
--
-- `is_admin()` não muda aqui de propósito: ela ainda aceita ('admin','dev'),
-- o que continua correto — só deixa de existir linha com role='dev'. A
-- limpeza dela vem na 0024, junto com o resto.

update public.profiles
set role = 'admin'
where role = 'dev';
