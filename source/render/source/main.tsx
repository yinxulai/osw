import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { LinearPrototypePage } from './pages/linear-prototype/page'
import './index.css'

const isLinearPrototype = window.location.pathname === '/design/linear'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isLinearPrototype ? <LinearPrototypePage /> : <App />}
  </React.StrictMode>,
)
