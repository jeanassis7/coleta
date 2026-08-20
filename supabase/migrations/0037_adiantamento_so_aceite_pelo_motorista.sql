-- ============================================================================
-- 0037 — Motorista só pode ACEITAR o adiantamento, não reescrevê-lo
-- ============================================================================
-- A RLS é por LINHA, não por coluna: a policy da 0008 ("motorista atualiza
-- próprio aceite") tecnicamente deixava um motorista alterar QUALQUER campo
-- do próprio adiantamento — inclusive `valor` e `status` — com a anon key
-- (que é pública no bundle) e o próprio login. O app nunca faz isso, mas
-- segurança que depende de "o app não faz" não é segurança.
--
-- O trigger trava as colunas de dinheiro pra quem não é admin. O aceite
-- legítimo (status pendente→aceito, aceito_em, GPS, pular_contador) passa.
--
-- service_role (endpoints do admin) tem auth.uid() nulo — passa direto.

create or replace function public.travar_colunas_adiantamento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service_role / jobs internos: sem JWT de usuário, sem trava.
  if auth.uid() is null then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;

  -- Daqui pra baixo é um MOTORISTA. Só o aceite muda.
  if new.valor is distinct from old.valor
    or new.motorista_id is distinct from old.motorista_id
    or new.data_envio is distinct from old.data_envio
    or new.forma_pagamento is distinct from old.forma_pagamento
    or new.observacao is distinct from old.observacao then
    raise exception 'motorista so pode confirmar o recebimento — os dados do adiantamento sao do gestor';
  end if;
  -- Status: pendente→aceito é o aceite; qualquer outra transição é do gestor.
  if new.status is distinct from old.status
    and not (old.status = 'pendente' and new.status = 'aceito') then
    raise exception 'motorista so pode confirmar o recebimento — os dados do adiantamento sao do gestor';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_travar_colunas_adiantamento on public.adiantamentos;
create trigger trg_travar_colunas_adiantamento
  before update on public.adiantamentos
  for each row
  execute function public.travar_colunas_adiantamento();
