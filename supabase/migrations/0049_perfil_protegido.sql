-- ============================================================================
-- 0049 — Perfil PROTEGIDO: motorista de verdade não se apaga
-- ============================================================================
-- Decisão do Evaner (21/08/2026): "um motorista nunca vai ser apagado. Se
-- alguém for apagado é porque é simulado e é pra apagar tudo mesmo."
--
-- O apagar forçado é destrutivo DE PROPÓSITO (leva coletas, contas pagas,
-- caixa — é o erase de perfil de teste). A blindagem é uma COLUNA no
-- cadastro (regra da casa: capacidade extra vira coluna, nunca papel):
-- quem tem `protegido = true` não pode ser apagado pelo painel, nem
-- forçado. Perfil simulado nasce desprotegido e o erase segue funcionando.
alter table public.profiles
  add column if not exists protegido boolean not null default false;

comment on column public.profiles.protegido is
  'true = o painel recusa apagar este perfil (até no modo forçado). Pros motoristas reais; perfil de teste fica false e o erase total funciona.';

-- Os três motoristas reais e o Valdecir (recebe pró-labore, tem lançamento
-- amarrado a ele) já nascem blindados. Admin não precisa: o painel já
-- recusa apagar admin desde sempre.
update public.profiles set protegido = true
where id in (
  select id from auth.users
  where email in ('luis@coleta.local', 'lucimar@coleta.local',
                  'lucinei@coleta.local', 'valdecir@coleta.local')
);
