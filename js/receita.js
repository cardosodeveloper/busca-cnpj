/* Base local da Receita (opcional): arquivo Parquet ou CSV gerado no seu computador
   (ferramentas do Radar de Mercado: preparar_receita.py e gerar_base_navegador.py).
   Serve para dois usos: achar o CNPJ pelo domínio do e-mail cadastrado, útil para domínios
   que não são .br, e completar os dados sem depender de APIs. O arquivo não sai do navegador. */
(function (exp) {
  'use strict';
  var D = window.DOM;
  var URL_ESM = 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/+esm';
  var PORTES = { 1: 'MICRO EMPRESA', 3: 'EMPRESA DE PEQUENO PORTE', 5: 'DEMAIS', 0: 'NÃO INFORMADO' };
  var db = null, con = null, duck = null, cols = [];

  async function iniciar() {
    if (db) return;
    duck = await import(URL_ESM);
    var bundle = await duck.selectBundle(duck.getJsDelivrBundles());
    var wurl = URL.createObjectURL(new Blob(['importScripts("' + bundle.mainWorker + '");'], { type: 'text/javascript' }));
    db = new duck.AsyncDuckDB(new duck.ConsoleLogger(duck.LogLevel.WARNING), new Worker(wurl));
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(wurl);
  }
  async function consultar(sql) {
    var t = await con.query(sql);
    return t.toArray().map(function (row) {
      var o = row.toJSON();
      Object.keys(o).forEach(function (k) { if (typeof o[k] === 'bigint') o[k] = Number(o[k]); });
      return o;
    });
  }
  function lit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
  function col(nome, tipo) { return cols.indexOf(nome) >= 0 ? nome : 'CAST(NULL AS ' + (tipo || 'VARCHAR') + ') AS ' + nome; }

  async function abrir(arquivo) {
    await iniciar();
    if (con) { await con.close(); con = null; }
    var csv = /\.csv$/i.test(arquivo.name), nome = 'base_' + Date.now() + (csv ? '.csv' : '.parquet');
    await db.registerFileHandle(nome, arquivo, duck.DuckDBDataProtocol.BROWSER_FILEREADER, true);
    con = await db.connect();
    var leitor = csv ? "read_csv('" + nome + "', header = true, all_varchar = true)" : "read_parquet('" + nome + "')";
    cols = (await consultar('DESCRIBE SELECT * FROM ' + leitor)).map(function (r) { return r.column_name; });
    var faltam = ['cnpj', 'razao_social', 'email'].filter(function (c) { return cols.indexOf(c) < 0; });
    if (faltam.length) throw new Error('O arquivo não tem as colunas: ' + faltam.join(', ') + '. Use a base gerada pelo gerar_base_navegador.py.');
    await con.query('CREATE OR REPLACE VIEW base AS SELECT ' + [
      'CAST(cnpj AS VARCHAR) AS cnpj', 'razao_social', col('nome_fantasia'), col('uf'), col('municipio'), 'CAST(' + (cols.indexOf('cnae') >= 0 ? 'cnae' : 'NULL') + ' AS VARCHAR) AS cnae',
      'CAST(' + (cols.indexOf('data_inicio') >= 0 ? 'data_inicio' : 'NULL') + ' AS VARCHAR) AS data_inicio',
      'CAST(' + (cols.indexOf('porte') >= 0 ? 'porte' : 'NULL') + ' AS VARCHAR) AS porte',
      'TRY_CAST(' + (cols.indexOf('capital_social') >= 0 ? 'capital_social' : 'NULL') + ' AS DOUBLE) AS capital_social',
      'TRY_CAST(' + (cols.indexOf('matriz') >= 0 ? 'matriz' : 'NULL') + ' AS INTEGER) AS matriz',
      'TRY_CAST(' + (cols.indexOf('qtd_estabelecimentos') >= 0 ? 'qtd_estabelecimentos' : 'NULL') + ' AS INTEGER) AS qtd_estabelecimentos',
      'LOWER(CAST(email AS VARCHAR)) AS email', col('telefone'),
      "LOWER(REGEXP_EXTRACT(CAST(email AS VARCHAR), '@([^@\\s]+)$', 1)) AS dominio_email"
    ].join(', ') + ' FROM ' + leitor);
    return (await consultar('SELECT COUNT(*)::INTEGER AS n FROM base'))[0].n;
  }

  function padronizar(r) {
    var p = r.porte != null && PORTES[Number(r.porte)] ? PORTES[Number(r.porte)] : (r.porte || '');
    return {
      cnpj: D.soDigitos(r.cnpj), razao_social: r.razao_social || '', nome_fantasia: r.nome_fantasia || '', situacao: 'ATIVA',
      uf: r.uf || '', municipio: r.municipio || '', cnae: r.cnae ? D.soDigitos(r.cnae).padStart(7, '0') : '', cnae_descricao: '',
      porte: p, capital_social: r.capital_social, data_abertura: r.data_inicio ? String(r.data_inicio).slice(0, 10) : '',
      matriz_filial: r.matriz === 1 ? 'MATRIZ' : r.matriz === 2 ? 'FILIAL' : '', natureza_juridica: '',
      email: r.email || '', telefone: D.soDigitos(r.telefone), qtd_estabelecimentos: r.qtd_estabelecimentos,
      fonte_dados: 'Base local da Receita'
    };
  }

  // domínio -> { melhor: dados, candidatos: n }. Prefere matriz, maior grupo e maior capital.
  async function porDominios(lista) {
    if (!con || !lista.length) return {};
    var vals = lista.map(function (d) { return '(' + lit(d) + ')'; }).join(', ');
    var linhas = await consultar('WITH d(dom) AS (VALUES ' + vals + '), c AS (SELECT d.dom, b.*, ' +
      'COUNT(*) OVER (PARTITION BY d.dom)::INTEGER AS candidatos, ROW_NUMBER() OVER (PARTITION BY d.dom ORDER BY COALESCE(b.matriz, 9), ' +
      'b.qtd_estabelecimentos DESC NULLS LAST, b.capital_social DESC NULLS LAST) AS ordem FROM d JOIN base b ON b.dominio_email = d.dom) ' +
      'SELECT * FROM c WHERE ordem = 1');
    var out = {};
    linhas.forEach(function (r) { out[r.dom] = { melhor: padronizar(r), candidatos: r.candidatos }; });
    return out;
  }

  async function porCnpj(cnpj) {
    if (!con) return null;
    var r = await consultar('SELECT * FROM base WHERE cnpj = ' + lit(D.soDigitos(cnpj)) + ' LIMIT 1');
    return r.length ? padronizar(r[0]) : null;
  }

  exp.abrir = abrir; exp.porDominios = porDominios; exp.porCnpj = porCnpj; exp.aberta = function () { return !!con; };
})(window.RECEITA = {});
