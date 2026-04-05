import { useState } from 'react'
import { useNotebookStore } from '../stores/notebookStore'

export default function OcrPanel() {
  const isOCRRunning = useNotebookStore((s) => s.isOCRRunning)
  const ocrProgress  = useNotebookStore((s) => s.ocrProgress)
  const ocrStatus    = useNotebookStore((s) => s.ocrStatus)
  const ocrText      = useNotebookStore((s) => s.ocrText)
  const clearOcrText = useNotebookStore((s) => s.clearOcrText)

  const [copied, setCopied] = useState(false)

  const isVisible = isOCRRunning || ocrText !== null
  if (!isVisible) return null

  function handleCopy() {
    if (!ocrText) return
    navigator.clipboard.writeText(ocrText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div
      className="fixed right-0 top-1/4 z-50 w-80 rounded-l-xl shadow-2xl bg-gray-800 text-white flex flex-col overflow-hidden"
      style={{ maxHeight: '60vh' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <span className="font-semibold text-sm tracking-wide">Texto reconocido</span>
        <button
          onClick={clearOcrText}
          className="text-gray-400 hover:text-white transition-colors text-lg leading-none"
          aria-label="Cerrar"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-3 p-4 overflow-y-auto flex-1">
        {isOCRRunning && (
          <div className="flex flex-col gap-2">
            {/* Progress bar */}
            <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
              <div
                className="h-2 bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${ocrProgress * 100}%` }}
              />
            </div>
            {/* Status message */}
            <p className="text-xs text-gray-300">{ocrStatus}</p>
          </div>
        )}

        {!isOCRRunning && ocrText !== null && (
          <div className="flex flex-col gap-3">
            <pre
              className="text-xs text-gray-100 whitespace-pre-wrap break-words bg-gray-900 rounded-lg p-3 overflow-y-auto"
              style={{ maxHeight: '30vh' }}
            >
              {ocrText}
            </pre>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="flex-1 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 transition-colors text-white text-sm font-medium py-1.5 px-3 rounded-lg"
              >
                Copiar texto
              </button>
              {copied && (
                <span className="text-green-400 text-xs font-medium">¡Copiado!</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
