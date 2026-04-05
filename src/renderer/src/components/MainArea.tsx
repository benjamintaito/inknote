import { RefObject } from 'react'
import InkCanvas from './Canvas/InkCanvas'
import PDFAnnotator from './PDF/PDFAnnotator'
import type { InkToolSettings } from '../hooks/useInkCanvas'
import { useNotebookStore } from '../stores/notebookStore'

interface MainAreaProps {
  toolRef?: RefObject<InkToolSettings>
}

export default function MainArea({ toolRef }: MainAreaProps) {
  const activePage = useNotebookStore((s) => s.activePage)
  const isPDFPage = activePage?.pdfPath != null

  return (
    <main className="flex flex-1 overflow-hidden">
      {isPDFPage
        ? <PDFAnnotator toolSettingsRef={toolRef} />
        : <InkCanvas toolSettingsRef={toolRef} />
      }
    </main>
  )
}
