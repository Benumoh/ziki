/**
 * A project's pages, with the slot for routes shown over them (#report-modal).
 * The quick report intercepts `issues/new` here, under the project, rather
 * than intercepting `[org]/[project]` from the app layout: intercepting a dynamic
 * top-level segment made Next rewrite the path into itself in a loop.
 *
 * There is no breadcrumb: the stage tabs say where you are, and the lists'
 * project filter says which projects they show (#project-filter).
 */
export default function ProjectLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  /** Intercepted routes shown over the page, e.g. the quick report. */
  modal: React.ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
