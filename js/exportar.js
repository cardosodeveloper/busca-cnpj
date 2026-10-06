/* Exportação para Excel (SheetJS) e CSV, gerada no próprio navegador. */
(function (exp) {
  'use strict';
  var TEXTO = ['cnpj', 'cnpj_basico', 'cnae', 'divisao', 'telefone', 'cep'];

  function baixar(blob, nome) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function colunas(linhas) {
    var c = [];
    linhas.forEach(function (r) { Object.keys(r).forEach(function (k) { if (c.indexOf(k) < 0) c.push(k); }); });
    return c;
  }

  // abas: { 'Nome da aba': [ {col: valor}, ... ] }, info: { campo: valor }
  function excel(abas, info, nome) {
    if (!window.XLSX) throw new Error('A biblioteca de Excel não carregou. Recarregue a página.');
    var wb = XLSX.utils.book_new();
    Object.keys(abas).forEach(function (n) {
      var linhas = abas[n], cols = colunas(linhas);
      var ws = XLSX.utils.json_to_sheet(linhas, { header: cols });
      ws['!cols'] = cols.map(function (c) {
        var max = c.length;
        linhas.slice(0, 300).forEach(function (r) { if (r[c] != null) max = Math.max(max, String(r[c]).length); });
        return { wch: Math.min(max + 2, 60) };
      });
      cols.forEach(function (c, ci) {
        if (!/capital/i.test(c)) return;
        for (var ri = 1; ri <= linhas.length; ri++) {
          var cel = ws[XLSX.utils.encode_cell({ r: ri, c: ci })];
          if (cel && cel.t === 'n') cel.z = '"R$" #,##0.00';
        }
      });
      if (linhas.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: linhas.length, c: cols.length - 1 } }) };
      XLSX.utils.book_append_sheet(wb, ws, n.slice(0, 31));
    });
    var meta = [['Campo', 'Valor'], ['Gerado em', new Date().toLocaleString('pt-BR')]];
    Object.keys(info || {}).forEach(function (k) { meta.push([k, info[k]]); });
    var wsi = XLSX.utils.aoa_to_sheet(meta); wsi['!cols'] = [{ wch: 30 }, { wch: 110 }];
    XLSX.utils.book_append_sheet(wb, wsi, 'Sobre');
    XLSX.writeFile(wb, nome);
  }

  // br=true: separador ';', vírgula decimal e zeros à esquerda preservados no Excel
  function csv(linhas, br, nome) {
    var cols = colunas(linhas), sep = br ? ';' : ',';
    function cel(v, c) {
      if (v == null) return '';
      if (typeof v === 'number') return br ? String(v).replace('.', ',') : String(v);
      var s = String(v);
      if (br && TEXTO.indexOf(c) >= 0 && /^\d+$/.test(s)) return '="' + s + '"';
      if (s.indexOf(sep) >= 0 || s.indexOf('"') >= 0 || /[\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    var out = [cols.join(sep)].concat(linhas.map(function (r) { return cols.map(function (c) { return cel(r[c], c); }).join(sep); }));
    baixar(new Blob(['\uFEFF' + out.join('\r\n')], { type: 'text/csv;charset=utf-8' }), nome);
  }

  exp.excel = excel; exp.csv = csv;
})(window.EXPORTAR = {});
