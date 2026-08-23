-- ============================================================================
-- 0059 — a trava de apagar deixa de ser um toggle do painel
-- ============================================================================
-- A coluna `protegido` (0049) sempre foi a coisa certa: motorista de verdade
-- se DESATIVA, não se apaga. Mas ela era uma caixinha na tabela de
-- Motoristas — e uma trava que se desliga com um clique, do lado do botão
-- que ela protege, protege pouco. Dois cliques distraídos e o histórico
-- inteiro de uma pessoa (coletas, cargas, despesas, adiantamentos, acertos,
-- e o usuário no Auth) some sem lixeira.
--
-- Decisão do Evaner (23/08/2026): as seis pessoas de verdade são
-- inapagáveis pelo app, ponto. O toggle sai da tela e sai da API.
--
-- Aqui embaixo vem a garantia que não depende de código nenhum: um trigger
-- que recusa o DELETE no banco. Vale pra API, pra script, pro SQL Editor —
-- pra qualquer caminho, inclusive um que alguém escreva daqui a um ano sem
-- lembrar desta regra.
--
-- COMO APAGAR DE VERDADE, se um dia for mesmo o caso: tirar a proteção por
-- SQL, com intenção, e só então apagar:
--     update public.profiles set protegido = false where id = '...';
-- É o mesmo espírito de "quem perde o acesso de admin só volta por SQL".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) As seis pessoas de verdade ficam protegidas
-- ---------------------------------------------------------------------------
-- Por e-mail (o identificador de login), não por nome: nome se edita na tela.
-- O perfil "Teste" fica de FORA de propósito — é ele que precisa continuar
-- apagável, porque o jeito de testar aqui é criar um perfil normal, usar de
-- verdade e apagar depois.
update public.profiles p
   set protegido = true
  from auth.users u
 where u.id = p.id
   and u.email in (
     'evaner@coleta.local',
     'jean@coleta.local',
     'lucimar@coleta.local',
     'lucinei@coleta.local',
     'luis@coleta.local',
     'valdecir@coleta.local'
   )
   and p.protegido is distinct from true;

-- ---------------------------------------------------------------------------
-- 2) O banco recusa apagar quem está protegido
-- ---------------------------------------------------------------------------
create or replace function public.impedir_delete_de_perfil_protegido()
returns trigger
language plpgsql
as $$
begin
  if old.protegido then
    raise exception
      'perfil % é protegido e não pode ser apagado. Motorista de verdade se DESATIVA, não se apaga. Se for mesmo pra apagar, tire a proteção por SQL primeiro.',
      old.nome
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_impedir_delete_protegido on public.profiles;
create trigger trg_impedir_delete_protegido
  before delete on public.profiles
  for each row
  execute function public.impedir_delete_de_perfil_protegido();

comment on column public.profiles.protegido is
  'Trava de apagar. NÃO é editável pelo painel desde a 0059 — o trigger '
  'trg_impedir_delete_protegido recusa o DELETE no banco. Só sai por SQL.';
