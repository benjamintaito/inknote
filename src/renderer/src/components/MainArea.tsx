import { RefObject } from 'react'
import InkCanvas from './Canvas/InkCanvas'
import PDFAnnotator from './PDF/PDFAnnotator'
import ErrorBoundary from './ErrorBoundary'
import OcrPanel from './OcrPanel'
import type { InkToolSettings } from '../hooks/useInkCanvas'
import { useNotebookStore } from '../stores/notebookStore'

interface MainAreaProps {
  toolRef?: RefObject<InkToolSettings>
}

export default function MainArea({ toolRef }: MainAreaProps) {
  const activePage = useNotebookStore((s) => s.activePage)
  const isPDFPage = activePage?.pdfPath != null

  return (
    <main className="relative flex flex-1 overflow-hidden">
      <ErrorBoundary message="Error al renderizar el lienzo">
        {isPDFPage
          ? <PDFAnnotator toolSettingsRef={toolRef} />
          : <InkCanvas toolSettingsRef={toolRef} />
        }
      </ErrorBoundary>
      <OcrPanel />
    </main>
  )
}
