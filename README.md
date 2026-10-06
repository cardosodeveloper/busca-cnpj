# Busca de CNPJ por domínio

Aplicação em HTML, CSS e JavaScript que recebe uma planilha com domínios, sites ou e-mails e devolve o CNPJ e os dados cadastrais de cada empresa, prontos para exportar. Roda inteira no navegador e pode ser publicada no GitHub Pages, como o Radar de Mercado.

## Como usar

1. **Carregar a planilha** (.xlsx, .xls ou .csv). Funciona direto com a aba Leads do Painel de Controle: a coluna "Domínio" é reconhecida sozinha.
2. **Escolher a aba e a coluna**, se a sugestão automática não for a certa. Sites, URLs e e-mails são convertidos para o domínio (ex.: `https://www.empresa.com.br/contato` vira `empresa.com.br`).
3. **Conferir as fontes** e clicar em **Buscar CNPJs**. Dá para pausar e parar.
4. **Exportar** em Excel (abas "Resultado", "Para a aba Leads" e "Sobre") ou CSV.

## De onde vêm os dados

| Etapa | Fonte pública | Para quê |
|---|---|---|
| Domínio → CNPJ (.br) | Registro.br, protocolo RDAP | O titular de um domínio .br é registrado com CNPJ ou CPF |
| Domínio → CNPJ (outros) | Base de CNPJ da Receita, aberta localmente (opcional) | Procura empresas com e-mail cadastrado no domínio |
| CNPJ → dados | BrasilAPI, com Minha Receita como reserva | Razão social, situação, CNAE, município, porte, capital, abertura |

A coluna **Cluster ICP** é calculada pela divisão do CNAE, com os mesmos clusters do Painel de Controle.

**Confiança:**
- **Alta:** CNPJ do titular do domínio e nome da empresa compatível com o domínio.
- **Média:** CNPJ do titular, mas nome diferente (pode ser agência, holding ou outra empresa do grupo), ou CNPJ achado pelo e-mail cadastrado na Receita.
- **Baixa:** várias empresas usam o mesmo domínio de e-mail.

## Limites

- **Domínios .com e outros não .br** não têm CNPJ público no registro. Para eles, abra a base local da Receita (gerada pelas ferramentas do Radar: `preparar_receita.py` e `gerar_base_navegador.py`). Quanto mais UFs e portes a base tiver, maior a cobertura.
- **Ritmo de consulta:** os serviços públicos limitam o número de consultas. O padrão é uma consulta a cada 1,2 s por serviço, ajustável em "Ajustes". Cem domínios levam alguns minutos.
- **Domínios genéricos** (gmail, hotmail etc.) e titulares pessoa física não geram CNPJ. O CPF nunca é exibido.
- As consultas saem do navegador para os serviços públicos. Se algum deles bloquear o acesso pelo navegador, a tela avisa e a busca é interrompida.

## Publicar no GitHub Pages

Envie os arquivos para a raiz de um repositório (inclusive `.nojekyll`) e ative **Settings → Pages → Deploy from a branch**, branch `main`, pasta `/ (root)`.

Para testar localmente, use um servidor (`python -m http.server 8000`) e abra `http://localhost:8000`. Com `?teste=1` no endereço, a busca usa respostas simuladas, sem internet. Nesse modo, domínios com "naoexiste", "pessoa", "agencia" ou "baixada" no nome simulam os casos especiais.

## Estrutura

```
index.html, styles.css    página e visual (mesma linha do Radar de Mercado)
js/app.js                 leitura do Excel, fila de busca, tabela e exportação
js/dominios.js            normalização de domínios, validação de CNPJ, cluster por CNAE
js/fontes.js              Registro.br (RDAP), BrasilAPI e Minha Receita
js/receita.js             base local da Receita com DuckDB no navegador
js/exportar.js            Excel e CSV
vendor/xlsx.full.min.js   leitura e escrita de Excel (SheetJS)
```
