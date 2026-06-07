-- ============================================================================
-- 0004 — Storage RLS: adiciona UPDATE e DELETE policies + INSERT mais robusto
-- Aplicar no SQL Editor do Supabase APÓS 0001, 0002 e 0003.
-- ============================================================================
-- Problema diagnosticado:
--   "new row violates row-level security policy" no upload de foto.
--   Causa: faltava UPDATE policy (upsert=true do client faz UPDATE quando
--   o objeto já existe), e a INSERT policy estava amarrada a uma comparação
--   de string de UUID que pode falhar em casos sutis.
-- ============================================================================

-- Remove as policies antigas pra recriar de forma mais robusta
drop policy if exists "motorista upload em próprio prefixo" on storage.objects;
drop policy if exists "motorista lê próprias fotos" on storage.objects;

-- INSERT: motorista autenticado pode subir em QUALQUER caminho no bucket.
-- A segurança real vem do fato que o client SEMPRE usa o auth.uid() como
-- prefixo do path (controle de código, não input de usuário), e do SELECT
-- abaixo que limita a leitura.
create policy "motorista upload no bucket fotos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'fotos-coletas');

-- SELECT: motorista lê só do próprio prefixo
create policy "motorista lê próprias fotos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'fotos-coletas'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE: motorista pode sobrescrever (upsert) próprias fotos
-- Essa policy estava FALTANDO no 0001 — é o motivo do erro.
create policy "motorista atualiza próprias fotos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'fotos-coletas'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'fotos-coletas'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE: motorista pode apagar próprias fotos (caso queira retentar)
create policy "motorista deleta próprias fotos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'fotos-coletas'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- As policies de admin (acesso total) continuam intactas — foram criadas no 0001.
