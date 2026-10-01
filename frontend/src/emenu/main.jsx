import React from 'react';
import ReactDOM from 'react-dom/client';
import MenuApp from './App.jsx';
import './emenu.css';

ReactDOM.createRoot(document.getElementById('menu')).render(
  <React.StrictMode>
    <MenuApp />
  </React.StrictMode>,
);
