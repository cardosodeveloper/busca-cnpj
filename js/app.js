(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var D, F, R, X;
  var CHAVE = 'busca-cnpj-ajustes-v1';
  var est = { wb: null, nomeArquivo: '', linhas: [], dominios: [], resultados: [], rodando: false, pausado: false, parar: false, filtro: 'todos' };

  // ---------------------------------------------------------------- utilidades
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(x, d) { return x == null || x === '' || isNaN(x) ? '' : Number(x).toLocaleString('pt-BR', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }); }
  function status(msg, tipo) { var el = $('status'); el.textContent = msg || ''; el.className = 'status' + (tipo ? ' ' + tipo : ''); }
  function dataBr(v) { var s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : s; }
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  // ---------------------------------------------------------------- leitura da planilha
  async function carregarPlanilha(arquivo) {
    if (!arquivo) return;
    try {
      var buf = await arquivo.arrayBuffer();
      est.wb = XLSX.read(buf, { type: 'array' });
      est.nomeArquivo = arquivo.name;
    } catch (e) { status('Não consegui ler o arquivo. Confira se é um Excel ou CSV válido.', 'erro'); return; }
    var abas = est.wb.SheetNames, sel = $('selAba'); sel.innerHTML = '';
    abas.forEach(function (n) { var o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
    var preferida = abas.find(function (n) { return D.semAcento(n).toLowerCase().trim() === 'leads'; }) || melhorAba(abas);
    sel.value = preferida; sel.disabled = abas.length < 2;
    $('arqNome').textContent = arquivo.name + ' carregado (' + abas.length + (abas.length === 1 ? ' aba).' : ' abas).');
    status('');
    lerAba();
  }

  function melhorAba(abas) {
    var melhor = abas[0], nota = -1;
    abas.forEach(function (n) {
      var linhas = XLSX.utils.sheet_to_json(est.wb.Sheets[n], { header: 1, defval: '', blankrows: false }).slice(0, 60);
      var c = 0; linhas.forEach(function (l) { l.forEach(function (v) { if (D.normalizar(v)) c++; }); });
      if (c > nota) { nota = c; melhor = n; }
    });
    return melhor;
  }

  function lerAba() {
    var ws = est.wb.Sheets[$('selAba').value];
    var linhas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
    var iCab = linhas.findIndex(function (l) { return l.some(function (v) { return String(v).trim() !== ''; }); });
    if (iCab < 0) { status('A aba escolhida está vazia.', 'erro'); return; }
    var cab = linhas[iCab].map(function (v, i) { return String(v).trim() || ('Coluna ' + (i + 1)); });
    est.cabecalho = cab; est.linhas = linhas.slice(iCab + 1);
    var sel = $('selColuna'); sel.innerHTML = '';
    cab.forEach(function (n, i) { var o = document.createElement('option'); o.value = i; o.textContent = n; sel.appendChild(o); });
    sel.value = String(melhorColuna(cab, est.linhas)); sel.disabled = false;
    prepararDominios();
  }

  function melhorColuna(cab, linhas) {
    var porNome = cab.findIndex(function (n) { return /dominio|site|url|website|e-?mail/.test(D.semAcento(n).toLowerCase()); });
    var conta = cab.map(function (_, i) { return linhas.slice(0, 200).filter(function (l) { return D.normalizar(l[i]); }).length; });
    if (porNome >= 0 && conta[porNome] > 0) return porNome;
    return conta.indexOf(Math.max.apply(null, conta));
  }

  function prepararDominios() {
    var i = Number($('selColuna').value), vistos = {}, invalidos = 0, genericos = 0, lista = [];
    est.linhas.forEach(function (l) {
      var orig = l[i]; if (String(orig).trim() === '') return;
      var d = D.normalizar(orig);
      if (!d) { invalidos++; return; }
      if (vistos[d]) return;
      vistos[d] = true;
      if (D.ehGenerico(d)) genericos++;
      lista.push({ original: String(orig).trim(), dominio: d });
    });
    est.dominios = lista;
    var br = lista.filter(function (x) { return D.ehBr(x.dominio); }).length;
    $('resumoEntrada').innerHTML = '<strong>' + num(lista.length) + ' domínios únicos</strong> (' + num(br) + ' .br e ' + num(lista.length - br) + ' outros)' +
      (genericos ? ', ' + num(genericos) + (genericos === 1 ? ' genérico' : ' genéricos') + ' (gmail, hotmail...)' : '') +
      (invalidos ? ', ' + num(invalidos) + (invalidos === 1 ? ' valor inválido ignorado' : ' valores inválidos ignorados') : '') + '.';
    $('btnBuscar').disabled = !lista.length;
  }

  // ---------------------------------------------------------------- busca
  function confianca(r) {
    if (!r.cnpj) return '';
    if (r.fonte_cnpj === 'Registro.br') return D.nomeConfere(r.dominio, [r.razao_social, r.nome_fantasia, r.titular]) ? 'Alta' : 'Média';
    return r.candidatos > 1 ? 'Baixa' : 'Média';
  }

  function linhaVazia(item) {
    return { dominio: item.dominio, valor_original: item.original, cnpj: '', razao_social: '', nome_fantasia: '', situacao: '', uf: '', municipio: '',
      cnae: '', cnae_descricao: '', cluster: '', porte: '', capital_social: null, data_abertura: '', matriz_filial: '', email: '', telefone: '',
      fonte_cnpj: '', fonte_dados: '', titular: '', candidatos: null, confianca: '', resultado: '', observacao: '' };
  }

  async function processar(item, mapaLocal) {
    var r = linhaVazia(item), obs = [];
    if (D.ehGenerico(item.dominio)) { r.resultado = 'Não encontrado'; r.observacao = 'Domínio de e-mail genérico: não identifica a empresa.'; return r; }
    try {
      if ($('usarRdap').checked && D.ehBr(item.dominio)) {
        var rd = await F.rdap(item.dominio);
        if (rd.cnpj) { r.cnpj = rd.cnpj; r.fonte_cnpj = 'Registro.br'; r.titular = rd.titular || ''; }
        else if (rd.cpf) obs.push('Titular do domínio é pessoa física.');
        else if (rd.inexistente) obs.push('Domínio .br não registrado.');
        else obs.push('Registro.br sem CNPJ do titular.');
      }
      if (!r.cnpj && mapaLocal[item.dominio]) {
        var m = mapaLocal[item.dominio];
        r.cnpj = m.melhor.cnpj; r.fonte_cnpj = 'Receita (e-mail cadastrado)'; r.candidatos = m.candidatos;
        Object.assign(r, dadosPara(m.melhor));
        if (m.candidatos > 1) obs.push(m.candidatos + ' empresas usam este domínio de e-mail; foi escolhida a matriz de maior porte.');
      }
      if (r.cnpj && !r.razao_social) {
        var dados = R.aberta() ? await R.porCnpj(r.cnpj) : null;
        if (!dados && $('usarApi').checked) dados = await F.dadosCnpj(r.cnpj);
        if (dados) Object.assign(r, dadosPara(dados));
        else obs.push('CNPJ encontrado, mas sem dados cadastrais nas fontes.');
      }
    } catch (e) {
      obs.push(e.message);
      if (e.tipo === 'limite') est.avisoLimite = true;
      if (e.tipo === 'rede') est.falhasRede = (est.falhasRede || 0) + 1;
    }
    if (r.cnpj) {
      r.cnpj_formatado = D.formatarCnpj(r.cnpj);
      r.cluster = D.clusterDoCnae(r.cnae);
      r.confianca = confianca(r);
      r.resultado = 'Encontrado';
      if (r.situacao && !/ATIVA/i.test(r.situacao)) obs.push('Situação cadastral: ' + r.situacao + '.');
      if (r.confianca === 'Média' && r.fonte_cnpj === 'Registro.br') obs.push('Nome não confere com o domínio: o titular pode ser agência ou holding.');
      if (r.cluster === 'Construção') obs.push('Cluster fora do ICP.');
    } else {
      r.resultado = 'Não encontrado';
      if (!D.ehBr(item.dominio) && !R.aberta()) obs.push('Domínio não .br: abra a base local da Receita para buscar pelo e-mail cadastrado.');
    }
    r.observacao = obs.join(' ');
    return r;
  }
  function dadosPara(d) {
    var o = {};
    ['razao_social', 'nome_fantasia', 'situacao', 'uf', 'municipio', 'cnae', 'cnae_descricao', 'porte', 'capital_social', 'data_abertura',
      'matriz_filial', 'email', 'telefone', 'fonte_dados', 'qtd_estabelecimentos'].forEach(function (k) { if (d[k] !== undefined) o[k] = d[k]; });
    return o;
  }

  async function buscar() {
    if (est.rodando) return;
    if (!$('usarRdap').checked && !R.aberta()) { status('Ative o Registro.br ou abra a base local da Receita: sem uma das duas, não há como achar o CNPJ.', 'erro'); return; }
    F.cfg.intervalo = Math.max(300, Number($('intervalo').value) || 1200);
    try { localStorage.setItem(CHAVE, JSON.stringify({ intervalo: F.cfg.intervalo })); } catch (e) { /* sem armazenamento */ }
    est.rodando = true; est.pausado = false; est.parar = false; est.resultados = []; est.avisoLimite = false; est.falhasRede = 0;
    $('btnBuscar').disabled = true; $('btnPausar').hidden = false; $('btnParar').hidden = false; $('btnPausar').textContent = 'Pausar';
    $('progresso').hidden = false; $('resultado').hidden = false; status('');
    var lista = est.dominios.slice(), mapaLocal = {};
    if (R.aberta()) {
      status('Procurando os domínios na base local da Receita', 'carregando');
      try { mapaLocal = await R.porDominios(lista.map(function (x) { return x.dominio; })); }
      catch (e) { status('Erro ao consultar a base local: ' + e.message, 'erro'); }
      status('');
    }
    var inicio = Date.now();
    for (var i = 0; i < lista.length; i++) {
      while (est.pausado && !est.parar) await espera(300);
      if (est.parar) break;
      est.resultados.push(await processar(lista[i], mapaLocal));
      atualizarProgresso(i + 1, lista.length, inicio);
      if (i % 3 === 0 || i === lista.length - 1) desenharResultado();
      if (est.falhasRede >= 3 && est.resultados.filter(function (r) { return r.cnpj; }).length === 0) {
        status('As fontes on-line não estão respondendo neste navegador (conexão ou bloqueio). A busca foi interrompida.', 'erro');
        break;
      }
    }
    est.rodando = false;
    $('btnBuscar').disabled = false; $('btnBuscar').textContent = 'Buscar de novo';
    $('btnPausar').hidden = true; $('btnParar').hidden = true;
    desenharResultado();
    var ok = est.resultados.filter(function (r) { return r.cnpj; }).length;
    if (!/erro/.test($('status').className)) status((est.parar ? 'Busca interrompida. ' : 'Busca concluída. ') + num(ok) + ' de ' + num(est.resultados.length) + ' domínios com CNPJ.' +
      (est.avisoLimite ? ' Alguns serviços limitaram as consultas: aumente o intervalo em Ajustes e busque de novo os que faltaram.' : ''));
  }

  function atualizarProgresso(feitos, total, inicio) {
    $('barra').style.width = (feitos / total * 100) + '%';
    var porItem = (Date.now() - inicio) / feitos, faltam = Math.round(porItem * (total - feitos) / 1000);
    $('progTexto').textContent = num(feitos) + ' de ' + num(total) + ' domínios' +
      (total > feitos ? ', cerca de ' + (faltam >= 60 ? Math.ceil(faltam / 60) + ' min' : faltam + ' s') + ' restantes' : '');
  }

  // ---------------------------------------------------------------- resultado
  function filtrados() {
    var q = D.semAcento($('busca').value).toLowerCase().trim();
    return est.resultados.filter(function (r) {
      if (est.filtro === 'encontrados' && !r.cnpj) return false;
      if (est.filtro === 'nao' && r.cnpj) return false;
      if (est.filtro === 'revisar' && !(r.cnpj && r.confianca !== 'Alta') && !(r.cnpj && r.observacao)) return false;
      if (q) {
        var alvo = D.semAcento([r.dominio, r.razao_social, r.nome_fantasia, r.cnpj, r.cnpj_formatado, r.municipio].join(' ')).toLowerCase();
        if (alvo.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function kpi(rotulo, valor, sub) {
    return '<div class="kpi"><span class="rotulo">' + esc(rotulo) + '</span><span class="valor">' + esc(valor) + '</span>' +
      (sub ? '<span class="delta neutro">' + esc(sub) + '</span>' : '') + '</div>';
  }

  function desenharResultado() {
    var rs = est.resultados, ok = rs.filter(function (r) { return r.cnpj; });
    var ativos = ok.filter(function (r) { return /ATIVA/i.test(r.situacao); }).length;
    var alta = ok.filter(function (r) { return r.confianca === 'Alta'; }).length;
    var taxa = rs.length ? Math.round(ok.length / rs.length * 100) : 0;
    $('kpis').innerHTML = kpi('Domínios processados', num(rs.length), 'de ' + num(est.dominios.length)) +
      kpi('CNPJs encontrados', num(ok.length), taxa + '% dos domínios') + kpi('Empresas ativas', num(ativos)) + kpi('Confiança alta', num(alta));
    var linhas = filtrados();
    if (!linhas.length) { $('tabela').innerHTML = '<p class="nota" style="padding:12px 14px">Nenhuma linha para este filtro.</p>'; return; }
    var cols = [['Domínio', 'dominio'], ['CNPJ', 'cnpj_formatado'], ['Confiança', 'confianca'], ['Razão social', 'razao_social'],
      ['Situação', 'situacao'], ['UF', 'uf'], ['Município', 'municipio'], ['Cluster', 'cluster'], ['Observação', 'observacao'], ['CNAE', 'cnae'],
      ['Porte', 'porte'], ['Capital social', 'capital_social'], ['Abertura', 'data_abertura'], ['Nome fantasia', 'nome_fantasia'], ['Fonte do CNPJ', 'fonte_cnpj']];
    var h = '<table><thead><tr>' + cols.map(function (c) { return '<th' + (c[1] === 'capital_social' ? ' class="num"' : '') + '>' + c[0] + '</th>'; }).join('') + '</tr></thead><tbody>';
    h += linhas.map(function (r) {
      return '<tr>' + cols.map(function (c) {
        var v = r[c[1]];
        if (c[1] === 'capital_social') return '<td class="num">' + (v ? 'R$ ' + num(v) : '') + '</td>';
        if (c[1] === 'data_abertura') return '<td>' + esc(dataBr(v)) + '</td>';
        if (c[1] === 'confianca') return '<td>' + (v ? '<span class="tag ' + D.semAcento(v).toLowerCase() + '">' + esc(v) + '</span>' : '<span class="tag nao">Sem CNPJ</span>') + '</td>';
        if (c[1] === 'observacao') return '<td class="obs" title="' + esc(v) + '">' + esc(v) + '</td>';
        return '<td>' + esc(v) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    $('tabela').innerHTML = h + '</tbody></table>';
  }

  // ---------------------------------------------------------------- exportação
  function linhasExportacao() {
    return est.resultados.map(function (r) {
      return { 'Domínio': r.dominio, 'Valor original': r.valor_original, 'CNPJ': r.cnpj_formatado || '', 'cnpj': r.cnpj, 'Razão social': r.razao_social,
        'Nome fantasia': r.nome_fantasia, 'Situação cadastral': r.situacao, 'UF': r.uf, 'Município': r.municipio, 'CNAE': r.cnae,
        'Descrição do CNAE': r.cnae_descricao, 'Cluster ICP': r.cluster, 'Porte': r.porte, 'Capital social (R$)': r.capital_social,
        'Data de abertura': dataBr(r.data_abertura), 'Matriz ou filial': r.matriz_filial, 'E-mail cadastrado': r.email, 'Telefone': r.telefone,
        'Fonte do CNPJ': r.fonte_cnpj, 'Fonte dos dados': r.fonte_dados, 'Titular do domínio': r.titular, 'Confiança': r.confianca,
        'Resultado': r.resultado, 'Observação': r.observacao };
    });
  }
  function linhasLeads() {
    // mesma ordem das colunas A a M da aba Leads do Painel de Controle (capital social cai na coluna M)
    return est.resultados.filter(function (r) { return r.cnpj; }).map(function (r) {
      return { 'Empresa (nome fantasia)': r.nome_fantasia || r.razao_social, 'Razão social': r.razao_social, 'Domínio': r.dominio, 'Endereço': '',
        'Cidade': r.municipio, 'UF': r.uf, 'Setor / vertical': r.cnae_descricao || r.cnae, 'Cluster ICP': r.cluster,
        'Funcionários (Apollo)': null, 'Funcionários (ajuste manual)': null, 'Funcionários considerados': null,
        'Qtd estabelecimentos (Receita)': r.qtd_estabelecimentos == null ? null : r.qtd_estabelecimentos,
        'Capital social (R$)': r.capital_social == null ? null : r.capital_social,
        'CNPJ': r.cnpj_formatado, 'Confiança': r.confianca };
    });
  }
  function exportar(formato) {
    if (!est.resultados.length) return;
    var base = 'cnpjs_por_dominio_' + new Date().toISOString().slice(0, 10);
    try {
      if (formato === 'xlsx') {
        X.excel({ 'Resultado': linhasExportacao(), 'Para a aba Leads': linhasLeads() }, {
          'Arquivo de origem': est.nomeArquivo, 'Aba e coluna': $('selAba').value + ' / ' + est.cabecalho[Number($('selColuna').value)],
          'Domínios processados': est.resultados.length, 'CNPJs encontrados': est.resultados.filter(function (r) { return r.cnpj; }).length,
          'Fontes': 'Registro.br (RDAP) para o titular de domínios .br; BrasilAPI e Minha Receita (dados abertos do CNPJ da Receita Federal); base local da Receita quando aberta',
          'Como colar no Painel': 'A aba "Para a aba Leads" segue as colunas A a M da aba Leads. Cole em dois blocos: A a H e depois L a M (quantidade de estabelecimentos e capital social). Não cole I a K, para não apagar a fórmula da coluna K. CNPJ e confiança vêm no fim, para conferência.',
          'Atenção': 'Confira as linhas de confiança média ou baixa antes de usar. O titular de um domínio pode ser agência, holding ou outra empresa do grupo.'
        }, base + '.xlsx');
      } else {
        X.csv(linhasExportacao(), formato === 'csv_br', base + (formato === 'csv_br' ? '_excel-br' : '') + '.csv');
      }
    } catch (e) { status(e.message, 'erro'); }
  }

  // ---------------------------------------------------------------- início
  function iniciar() {
    D = window.DOM; F = window.FONTES; R = window.RECEITA; X = window.EXPORTAR;
    if (F.modoTeste) document.querySelector('.brand p').textContent += ' Modo de teste: respostas simuladas.';
    try { var a = JSON.parse(localStorage.getItem(CHAVE)); if (a && a.intervalo) $('intervalo').value = a.intervalo; } catch (e) { /* sem armazenamento */ }

    var drop = $('drop');
    $('arqPlanilha').addEventListener('change', function () { carregarPlanilha(this.files[0]); });
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('ativo'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('ativo'); }); });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) carregarPlanilha(e.dataTransfer.files[0]); });
    $('selAba').addEventListener('change', lerAba);
    $('selColuna').addEventListener('change', prepararDominios);

    $('arqBase').addEventListener('change', async function () {
      var f = this.files[0]; if (!f) return;
      $('baseInfo').className = 'status carregando'; $('baseInfo').textContent = 'Abrindo ' + f.name + ' (na primeira vez, o leitor é baixado)';
      try {
        var n = await R.abrir(f);
        $('baseInfo').className = 'nota'; $('baseInfo').textContent = f.name + ': ' + num(n) + ' empresas disponíveis para consulta.';
      } catch (e) { $('baseInfo').className = 'status erro'; $('baseInfo').textContent = 'Não foi possível abrir a base: ' + e.message; }
    });

    $('btnBuscar').addEventListener('click', buscar);
    $('btnPausar').addEventListener('click', function () {
      est.pausado = !est.pausado; this.textContent = est.pausado ? 'Continuar' : 'Pausar';
      status(est.pausado ? 'Busca pausada.' : '');
    });
    $('btnParar').addEventListener('click', function () { est.parar = true; est.pausado = false; });
    document.querySelectorAll('[data-filtro]').forEach(function (b) {
      b.addEventListener('click', function () {
        est.filtro = b.dataset.filtro;
        document.querySelectorAll('[data-filtro]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        desenharResultado();
      });
    });
    $('busca').addEventListener('input', desenharResultado);
    document.querySelectorAll('[data-exportar]').forEach(function (b) { b.addEventListener('click', function () { exportar(b.dataset.exportar); }); });
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})();
