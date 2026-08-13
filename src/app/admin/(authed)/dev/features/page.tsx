import { buscarMotoristasTeste } from "@/lib/admin/queries";
import { FeaturesPanel } from "@/components/admin/FeaturesPanel";

export const dynamic = "force-dynamic";

const FEATURES_DISPONIVEIS = [
  {
    key: "carga",
    label: "Cargas + viagem",
    descricao:
      "Habilita o fluxo de iniciar carga, escolher caminhão, registrar abastecimento/despesas, descarregar. Se OFF, motorista continua com o fluxo antigo (só coleta).",
  },
  {
    key: "saldo",
    label: "Adiantamentos no app (aceite + card de saldo)",
    descricao:
      "Se ON, motorista vê a tela de aceite quando recebe adiantamento E o card 'Seu dinheiro' na home. Se OFF, nada disso aparece pra ele (adiantamentos pendentes ficam invisíveis até ligar).",
  },
];

export default async function DevFeaturesPage() {
  const motoristas = await buscarMotoristasTeste();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">🧪 Dev · Features</h1>
      <p className="text-cinza-suave mb-6">
        Painel de toggles por motorista de teste. Só você (dev) vê essa página.
        Ligar feature aqui não afeta motoristas reais.
      </p>

      {motoristas.length === 0 ? (
        <div className="card">
          <p className="text-cinza-suave">
            Nenhum motorista de teste cadastrado. Rode{" "}
            <code className="bg-slate-100 px-2 py-1 rounded">
              node scripts/criar-motorista-teste.mjs
            </code>{" "}
            pra criar um.
          </p>
        </div>
      ) : (
        <FeaturesPanel
          motoristas={motoristas}
          featuresDisponiveis={FEATURES_DISPONIVEIS}
        />
      )}
    </div>
  );
}
