-- ============================================================================
-- 0063 — POSTO PODE NASCER SEM GPS, E APRENDE ONDE FICA SOZINHO
-- ============================================================================
-- O gestor cadastra o posto pelo NOME, do escritório, quando o extrato chega
-- ("Centro Oeste"). Ele não tem a coordenada — quem tem é o motorista, que
-- está na bomba com o celular no bolso.
--
-- Exigir GPS no cadastro obrigaria o Jean a inventar um ponto no mapa, e
-- coordenada inventada é pior que coordenada ausente: ela entra no raio de
-- 100 m e passa a "casar" com abastecimento que não é dali.
--
-- ⚠️ Só POSTO pode nascer sem GPS. Local de COLETA sem coordenada quebraria o
-- casamento por proximidade, que é a razão de ele existir.

alter table public.locais
  alter column latitude  drop not null,
  alter column longitude drop not null;

alter table public.locais drop constraint if exists local_coleta_precisa_gps;
alter table public.locais add constraint local_coleta_precisa_gps check (
  tipo <> 'coleta' or (latitude is not null and longitude is not null)
);

comment on column public.locais.latitude is
  'Nulo só em POSTO cadastrado pelo painel antes de alguém abastecer lá. '
  'O primeiro abastecimento com GPS preenche (trigger trg_posto_aprende_gps).';

-- ---------------------------------------------------------------------------
-- O posto aprende onde fica no primeiro abastecimento
-- ---------------------------------------------------------------------------
-- Não é enfeite: sem coordenada, a sugestão "⛽ Você está no posto:" nunca
-- aparece pro motorista e ele volta a digitar o nome na mão — que é
-- exatamente como nasceram "Texas" e "Posto texas".
--
-- Só preenche quando está VAZIO. Abastecimento lançado longe da bomba (já
-- aconteceu: um "Texas" caiu a 4,3 km) não pode mudar o ponto de um posto que
-- já se conhece.
create or replace function public.posto_aprende_gps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.local_id is not null
     and new.latitude is not null
     and new.longitude is not null then
    update public.locais
       set latitude = new.latitude,
           longitude = new.longitude
     where id = new.local_id
       and tipo = 'posto'
       and latitude is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_posto_aprende_gps on public.abastecimentos;
create trigger trg_posto_aprende_gps
  after insert on public.abastecimentos
  for each row execute function public.posto_aprende_gps();
