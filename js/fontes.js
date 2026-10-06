/* Fontes públicas consultadas direto do navegador:
   - Registro.br (RDAP): titular de domínios .br, com o CNPJ quando é pessoa jurídica.
   - BrasilAPI e Minha Receita: dados cadastrais do CNPJ, a partir dos dados abertos da Receita Federal.
   Cada serviço tem uma fila própria com intervalo mínimo entre consultas, para respeitar os limites de uso.
   Modo de teste: abra a página com ?teste=1 para usar respostas simuladas, sem internet. */
(function (exp) {
  'use strict';
  var D = window.DOM;
  var TESTE = /[?&]teste=1\b/.test(location.search);
  var cfg = { intervalo: 1200 };
  var ultimo = {};
  var espera = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };

  function ErroFonte(msg, tipo) { var e = new Error(msg); e.tipo = tipo || 'erro'; return e; }

  async function vez(servico) {
    var agora = Date.now(), prox = Math.max(agora, (ultimo[servico] || 0) + cfg.intervalo);
    ultimo[servico] = prox;
    if (prox > agora) await espera(prox - agora);
  }

  async function obterJson(url, servico, tentativa) {
    tentativa = tentativa || 0;
    await vez(servico);
    var r;
    try { r = await fetch(url, { headers: { Accept: 'application/json, application/rdap+json' } }); }
    catch (e) { throw ErroFonte('Sem resposta de ' + servico + ' (conexão ou bloqueio do navegador).', 'rede'); }
    if (r.status === 404) return null;
    if ((r.status === 429 || r.status >= 500) && tentativa < 3) {
      var ra = Number(r.headers.get('Retry-After'));
      await espera(ra > 0 ? ra * 1000 : 4000 * Math.pow(2, tentativa));
      return obterJson(url, servico, tentativa + 1);
    }
    if (r.status === 429) throw ErroFonte(servico + ' limitou as consultas. Aumente o intervalo e tente de novo.', 'limite');
    if (!r.ok) throw ErroFonte(servico + ' respondeu ' + r.status + '.', 'erro');
    try { return await r.json(); } catch (e) { throw ErroFonte(servico + ' devolveu uma resposta inválida.', 'erro'); }
  }

  function punycode(d) { try { return new URL('http://' + d).hostname; } catch (e) { return d; } }

  // ---------------- Registro.br (RDAP)
  function entidades(obj, out) {
    (obj.entities || []).forEach(function (e) { out.push(e); entidades(e, out); });
    return out;
  }
  function nomeVcard(e) {
    var v = e.vcardArray && e.vcardArray[1];
    var fn = (v || []).find(function (x) { return x[0] === 'fn'; });
    return fn ? fn[3] : '';
  }
  function lerRdap(j) {
    var todas = entidades(j, []);
    var ordem = todas.filter(function (e) { return (e.roles || []).indexOf('registrant') >= 0; }).concat(todas);
    for (var i = 0; i < ordem.length; i++) {
      var ids = ordem[i].publicIds || [];
      for (var k = 0; k < ids.length; k++) {
        var tipo = String(ids[k].type || '').toLowerCase();
        var num = D.soDigitos(ids[k].identifier);
        if (tipo.indexOf('cnpj') >= 0 && D.cnpjValido(num)) return { cnpj: num, titular: nomeVcard(ordem[i]) };
        if (tipo.indexOf('cpf') >= 0) return { cpf: true, titular: '' };
      }
    }
    return { titular: ordem.length ? nomeVcard(ordem[0]) : '' };
  }
  async function rdap(dominio) {
    if (TESTE) return teste.rdap(dominio);
    var j = await obterJson('https://rdap.registro.br/domain/' + encodeURIComponent(punycode(dominio)), 'Registro.br');
    if (!j) return { inexistente: true };
    return lerRdap(j);
  }

  // ---------------- Dados do CNPJ
  function primeiro(o, chaves) {
    for (var i = 0; i < chaves.length; i++) { var v = o[chaves[i]]; if (v !== undefined && v !== null && v !== '') return v; }
    return '';
  }
  function capital(v) {
    if (v === '' || v == null) return null;
    var n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
    return isFinite(n) ? n : null;
  }
  function padronizar(o, fonte) {
    var cnae = D.soDigitos(primeiro(o, ['cnae_fiscal', 'cnae']));
    var mf = primeiro(o, ['descricao_identificador_matriz_filial', 'descricao_matriz_filial']);
    if (!mf) { var id = Number(primeiro(o, ['identificador_matriz_filial'])); mf = id === 1 ? 'MATRIZ' : id === 2 ? 'FILIAL' : ''; }
    var tel = primeiro(o, ['ddd_telefone_1', 'telefone_1', 'telefone']);
    return {
      cnpj: D.soDigitos(primeiro(o, ['cnpj'])), razao_social: primeiro(o, ['razao_social']), nome_fantasia: primeiro(o, ['nome_fantasia']),
      situacao: primeiro(o, ['descricao_situacao_cadastral', 'situacao_cadastral']), uf: primeiro(o, ['uf']),
      municipio: primeiro(o, ['municipio']), cnae: cnae ? cnae.padStart(7, '0') : '', cnae_descricao: primeiro(o, ['cnae_fiscal_descricao']),
      porte: primeiro(o, ['porte', 'descricao_porte']), capital_social: capital(primeiro(o, ['capital_social'])),
      data_abertura: primeiro(o, ['data_inicio_atividade']), matriz_filial: String(mf).toUpperCase(),
      natureza_juridica: primeiro(o, ['natureza_juridica']), email: String(primeiro(o, ['email']) || '').toLowerCase(),
      telefone: D.soDigitos(tel), fonte_dados: fonte
    };
  }
  async function dadosCnpj(cnpj) {
    if (TESTE) return teste.cnpj(cnpj);
    var erro = null;
    try {
      var a = await obterJson('https://brasilapi.com.br/api/cnpj/v1/' + cnpj, 'BrasilAPI');
      if (a) return padronizar(a, 'BrasilAPI');
    } catch (e) { erro = e; }
    try {
      var b = await obterJson('https://minhareceita.org/' + cnpj, 'Minha Receita');
      if (b) return padronizar(b, 'Minha Receita');
    } catch (e) { erro = erro || e; }
    if (erro) throw erro;
    return null;
  }

  // ---------------- respostas simuladas (?teste=1)
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function cnpjFalso(semente) {
    var base = String(10000000 + semente % 89999999) + '0001';
    function dv(b) { var p = b.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      var s = 0; for (var i = 0; i < b.length; i++) s += Number(b[i]) * p[i]; var r = s % 11; return r < 2 ? 0 : 11 - r; }
    var d1 = dv(base), d2 = dv(base + d1); return base + d1 + d2;
  }
  var nomesFalsos = {};
  var teste = {
    rdap: async function (d) {
      await espera(120);
      if (/naoexiste/.test(d)) return { inexistente: true };
      if (/pessoa/.test(d)) return { cpf: true, titular: '' };
      var c = cnpjFalso(hash(d));
      nomesFalsos[c] = /agencia/.test(d) ? 'AGENCIA DIGITAL CRIATIVA LTDA' : D.radical(d).toUpperCase() + ' INDUSTRIA E COMERCIO LTDA';
      nomesFalsos[c + 'b'] = /baixada/.test(d);
      return { cnpj: c, titular: nomesFalsos[c] };
    },
    cnpj: async function (c) {
      await espera(120);
      var h = hash(c), cnaes = ['6201501', '1091101', '4930202', '4711302', '8610101', '8513900', '4120400', '2511000'];
      var munis = [['RS', 'PORTO ALEGRE'], ['RS', 'CAXIAS DO SUL'], ['SC', 'JOINVILLE'], ['SP', 'SOROCABA']];
      var m = munis[h % munis.length];
      return padronizar({ cnpj: c, razao_social: nomesFalsos[c] || 'EMPRESA TESTE LTDA', nome_fantasia: '',
        descricao_situacao_cadastral: nomesFalsos[c + 'b'] ? 'BAIXADA' : 'ATIVA', uf: m[0], municipio: m[1],
        cnae_fiscal: cnaes[h % cnaes.length], cnae_fiscal_descricao: 'Atividade simulada', porte: ['DEMAIS', 'EMPRESA DE PEQUENO PORTE'][h % 2],
        capital_social: (h % 5000) * 1000, data_inicio_atividade: (1990 + h % 34) + '-03-15', identificador_matriz_filial: 1,
        email: 'contato@exemplo.com.br', ddd_telefone_1: '5133334444' }, 'Teste');
    }
  };

  exp.rdap = rdap; exp.dadosCnpj = dadosCnpj; exp.cfg = cfg; exp.modoTeste = TESTE; exp.lerRdap = lerRdap;
})(window.FONTES = {});
