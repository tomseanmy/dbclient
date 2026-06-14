/**
 * Monaco Editor 本地加载配置
 *
 * @monaco-editor/react 默认从 CDN 加载 monaco-editor，
 * 在 Electron CSP（script-src 'self'）下会被阻止。
 * 这里改为从本地 node_modules 加载。
 *
 * 此文件必须在渲染进程入口（main.tsx）最先 import。
 */
import { loader } from '@monaco-editor/react'
import * as monacoEditor from 'monaco-editor'

// 使用本地打包的 monaco-editor，避免 CDN 请求
loader.config({ monaco: monacoEditor })
