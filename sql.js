function gerarUpdates(rows) {
  return rows.filter(r => r.cep_alterado).map((r, i) => {
    const codigo = r.cli_codigo;
    if (!((typeof codigo === 'number' && Number.isSafeInteger(codigo)) || (typeof codigo === 'string' && codigo.trim() && !/[\x00-\x1f\x7f]/.test(codigo)))) {
      throw new Error(`Cliente alterado ${i + 1} possui cli_codigo ausente ou inválido; corrija o JSON antes de exportar SQL.`);
    }
    if (typeof r.cli_cep !== 'string' || !/^\d{2}\.\d{3}-\d{3}$/.test(r.cli_cep)) throw new Error(`Cliente alterado ${i + 1} possui CEP inválido.`);
    const literal = typeof codigo === 'number' ? String(codigo) : `'${codigo.replace(/'/g, "''")}'`;
    return `UPDATE clientes SET cli_cep = '${r.cli_cep}' WHERE cli_codigo = ${literal};`;
  }).join('\r\n') + (rows.some(r => r.cep_alterado) ? '\r\n' : '');
}
module.exports = { gerarUpdates };
