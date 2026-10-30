# Vistoria Fotográfica

Aplicativo web para registro, acompanhamento e geração de relatórios fotográficos de vistoria em obra.

## Funcionalidades

- Cadastro do empreendimento, auditor e setor
- Captura de fotos do dispositivo ou upload do computador
- Marcação automática de dados no canto inferior da imagem
- Seleção de pavimento/ambiente
- Salvamento local das fotos no IndexedDB do navegador
- Geração de relatório PDF com as imagens e observações
- Persistência dos dados do formulário no localStorage

## Estrutura do projeto

- `www/` — aplicação principal
  - `index.html` — página principal
  - `css/styles.css` — estilos
  - `js/` — módulos JavaScript
  - `data/floors.json` — dados de pavimentos
- `index.html` — redireciona para a aplicação em `www/`
- `logo-fg.png` — logo da empresa
- `package.json` — configuração do projeto e scripts

## Como executar

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Inicie o servidor:
   ```bash
   npm start
   ```
3. Acesse a aplicação em:
   ```bash
   http://localhost:3000
   ```

## Script de desenvolvimento

```bash
npm run dev
```

## Observações

A aplicação foi pensada para funcionar em navegador e não depende de backend. Os registros ficam salvos localmente no navegador para facilitar o uso em campo.
