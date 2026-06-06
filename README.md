# JJHS Coleta

App PWA para registrar coletas de óleo lubrificante usado em campo, com painel administrativo.

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind · Supabase · Dexie · Leaflet · Serwist (PWA)

## Para começar

Veja **[SETUP.md](./SETUP.md)** — guia passo a passo do zero até produção (Supabase + Vercel).

## Desenvolvimento

```powershell
npm install
npm run dev
```

Abre em `http://localhost:3000`.

## Estrutura

```
src/
├── app/
│   ├── motorista/        # PWA do motorista
│   ├── admin/            # Painel administrativo
│   └── api/admin/        # Endpoints com service_role
├── components/           # Componentes por área
├── lib/
│   ├── supabase/         # 3 clientes: browser, server, admin
│   ├── db/dexie.ts       # IndexedDB local (fila offline)
│   ├── sync/             # Sync queue + triggers sem polling
│   ├── gps/              # Captura GPS com timeout
│   ├── image/            # Compressão de foto
│   ├── events/           # Log estruturado
│   └── format.ts         # Formatação BR (R$, litros, datas)
└── middleware.ts         # Auth + RBAC

supabase/migrations/
└── 0001_initial.sql      # Schema completo + RLS + Storage

docs/superpowers/specs/
└── 2026-06-06-app-coleta-oluc-design.md   # Spec de design completa
```

## Características V1

- Offline-first com sync transparente
- Sem polling — protege bateria
- Botão "Enviar agora" como fallback quando há pendentes + online
- GPS robusto com timeout, salva mesmo se falhar
- Foto opcional por motorista (toggle remoto controlado pelo admin)
- Certificado de coleta integrado (integral / parcial / não)
- Log de eventos do app pra debug remoto
- Mapa OSM no painel, sem custo

## Custos

R$ 0/mês até bater limite do free tier (uns 20k coletas).

## Licença

Privado — JJHS.
