const card = "rounded-[20px] border border-zk-border bg-zk-surface p-5 sm:p-[22px]";
const bone = "rounded bg-zk-border";

/** The rejected ideas page while it loads. */
export default function LoadingRejectedIdeas() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 pb-10" aria-busy="true" aria-label="Rejected ideas">
      <div className={`${bone} h-3 w-56`} aria-hidden="true" />
      <header className="flex flex-col gap-2" aria-hidden="true">
        <div className={`${bone} h-8 w-40`} />
        <div className={`${bone} h-3 w-full max-w-xl`} />
        <div className={`${bone} h-3 w-2/3 max-w-md`} />
      </header>
      <p role="status" className="sr-only">
        Loading rejected ideas…
      </p>
      <ul className="flex list-none flex-col gap-4 p-0" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <li key={index} className={card}>
            <div className="flex flex-col gap-4">
              <div className={`${bone} h-3 w-2/5`} />
              <div className={`${bone} h-5 w-4/5`} />
              <div className={`${bone} h-3 w-full`} />
              <div className={`${bone} h-3 w-3/4`} />
              <div className={`${bone} h-12 w-full rounded-xl`} />
              <div className={`${bone} h-3 w-1/3`} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
