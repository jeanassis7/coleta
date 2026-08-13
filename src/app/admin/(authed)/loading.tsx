/**
 * Esqueleto mostrado enquanto a página do admin carrega no servidor.
 *
 * Sem isso, clicar num item do menu não fazia NADA na tela até o servidor
 * responder — dava a impressão de travado (reclamação do Evaner). Com o
 * esqueleto, a navegação responde na hora e o conteúdo entra depois.
 * Vale pra todas as páginas de /admin/(authed) que não têm loading próprio.
 */
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="h-8 w-56 bg-slate-200 rounded-lg mb-6" />
      <div className="h-24 bg-slate-100 rounded-2xl mb-4" />
      <div className="space-y-2">
        <div className="h-12 bg-slate-100 rounded-xl" />
        <div className="h-12 bg-slate-100 rounded-xl" />
        <div className="h-12 bg-slate-100 rounded-xl" />
        <div className="h-12 bg-slate-100 rounded-xl" />
        <div className="h-12 bg-slate-100 rounded-xl" />
      </div>
      <p className="sr-only">Carregando…</p>
    </div>
  );
}
