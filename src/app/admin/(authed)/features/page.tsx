import { buscarMotoristas } from "@/lib/admin/queries";
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

export default async function FeaturesPage() {
  const motoristas = (await buscarMotoristas()).filter(
    (m) => m.role === "motorista"
  );

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Features por motorista</h1>
      <p className="text-cinza-suave mb-6">
        Liga um recurso novo em um motorista de cada vez. Feature nova nasce
        desligada pra todos — ligue em um, acompanhe alguns dias, depois
        estenda. Desligar não apaga nada que já foi lançado: só some da tela
        dele.
      </p>

      {motoristas.length === 0 ? (
        <div className="card">
          <p className="text-cinza-suave">
            Nenhum motorista cadastrado ainda.
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
