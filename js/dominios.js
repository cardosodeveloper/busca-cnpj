/* Domínios, CNPJ e cluster: funções puras (rodam no navegador e no Node para testes). */
(function (exp) {
  'use strict';

  var GENERICOS = ['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com', 'outlook.com.br', 'live.com',
    'msn.com', 'yahoo.com', 'yahoo.com.br', 'icloud.com', 'me.com', 'bol.com.br', 'uol.com.br', 'terra.com.br', 'ig.com.br',
    'globo.com', 'globomail.com', 'r7.com', 'zipmail.com.br', 'proton.me', 'protonmail.com'];

  // Categorias de segundo nível do .br (ex.: com.br, ind.br): o domínio registrável tem 3 partes
  var SLD_BR = ['com', 'net', 'org', 'ind', 'eco', 'emp', 'tec', 'inf', 'srv', 'app', 'art', 'adm', 'adv', 'arq', 'eng', 'med',
    'odo', 'psi', 'vet', 'agr', 'far', 'fot', 'imb', 'jor', 'esp', 'rec', 'tmp', 'tur', 'tv', 'blog', 'nom', 'ong', 'edu', 'gov',
    'coop', 'seg', 'log', 'mus', 'leg', 'jus', 'mp', 'radio', 'b', 'dev', 'ia', 'bio', 'cnt', 'eti', 'flog', 'vlog', 'wiki', 'etc', 'bet'];

  function semAcento(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

  // Aceita site, URL, e-mail ou domínio e devolve o domínio registrável em minúsculas (ou '' se inválido)
  function normalizar(valor) {
    var s = String(valor == null ? '' : valor).trim().toLowerCase();
    if (!s) return '';
    if (s.indexOf('@') >= 0) s = s.split('@').pop();
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[\/?#\s]/)[0].split(':')[0].replace(/\.$/, '');
    s = s.replace(/^www\d*\./, '');
    if (!/^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+$/u.test(s)) return '';
    return raiz(s);
  }

  function raiz(d) {
    var p = d.split('.');
    if (p[p.length - 1] === 'br' && p.length >= 3 && SLD_BR.indexOf(p[p.length - 2]) >= 0) return p.slice(-3).join('.');
    return p.slice(-2).join('.');
  }

  function ehBr(d) { return /\.br$/.test(d); }
  function ehGenerico(d) { return GENERICOS.indexOf(d) >= 0; }
  function radical(d) { return semAcento(String(d).split('.')[0]).replace(/[^a-z0-9]/g, ''); }

  // O nome da empresa contém o radical do domínio (ou o radical contém as iniciais do nome)?
  function nomeConfere(dom, nomes) {
    var r = radical(dom);
    if (r.length < 3) return false;
    return nomes.filter(Boolean).some(function (n) {
      var x = semAcento(n).toLowerCase();
      var junto = x.replace(/[^a-z0-9]/g, '');
      if (junto.indexOf(r) >= 0) return true;
      var palavras = x.split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2 && ['ltda', 'eireli', 'cia', 'industria', 'comercio'].indexOf(w) < 0; });
      if (palavras.some(function (w) { return w.length >= 4 && r.indexOf(w) >= 0; })) return true;
      var iniciais = palavras.map(function (w) { return w[0]; }).join('');
      return iniciais.length >= 3 && r.indexOf(iniciais) === 0;
    });
  }

  function soDigitos(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
  function cnpjValido(v) {
    var c = soDigitos(v);
    if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
    function dv(base) {
      var pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      var s = 0; for (var i = 0; i < base.length; i++) s += Number(base[i]) * pesos[i];
      var r = s % 11; return r < 2 ? 0 : 11 - r;
    }
    return dv(c.slice(0, 12)) === Number(c[12]) && dv(c.slice(0, 13)) === Number(c[13]);
  }
  function formatarCnpj(v) {
    var c = soDigitos(v);
    return c.length === 14 ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : String(v || '');
  }

  // Clusters do Painel de Controle, pela divisão CNAE (2 primeiros dígitos)
  var CLUSTERS = {
    'Tecnologia e serviços financeiros': ['58', '61', '62', '63', '64', '66', '73'],
    'Indústria regional': ['10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32'],
    'Serviços com equipe de campo': ['33', '43', '49', '52', '53', '77', '78', '80', '81'],
    'Varejo e atacado': ['45', '46', '47'],
    'Saúde': ['86', '87'],
    'Educação': ['85'],
    'Alimentação e hospedagem': ['55', '56'],
    'Agronegócio': ['01', '02', '03'],
    'Serviços profissionais': ['69', '70', '71', '74', '82'],
    'Construção': ['41', '42']
  };
  function clusterDoCnae(cnae) {
    var d = soDigitos(cnae).padStart(7, '0').slice(0, 2);
    if (!soDigitos(cnae)) return '';
    for (var k in CLUSTERS) if (CLUSTERS[k].indexOf(d) >= 0) return k;
    return 'Outro';
  }

  exp.normalizar = normalizar; exp.raiz = raiz; exp.ehBr = ehBr; exp.ehGenerico = ehGenerico; exp.radical = radical;
  exp.nomeConfere = nomeConfere; exp.soDigitos = soDigitos; exp.cnpjValido = cnpjValido; exp.formatarCnpj = formatarCnpj;
  exp.clusterDoCnae = clusterDoCnae; exp.CLUSTERS = CLUSTERS; exp.semAcento = semAcento;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.DOM = {}));
