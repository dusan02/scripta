const data = {
  targetType: "COMPANY",
  ico: "36699624",
  sources: [
    'ORSR', 'ZRSR', 'RPO', 'RPVS', 'OBCHODNY_VESTNIK', 'INSOLVENCY',
    'POVERENIA', 'FINANCNA_SPRAVA', 'SP_DLZNICI', 'VSZP_DLZNICI',
    'DOVERA_DLZNICI', 'UNION_DLZNICI', 'DISKVALIFIKACIE', 'NCRZP',
    'NCRD', 'FS_DANOVE_SUBJEKTY', 'FS_DPH_REGISTROVANI', 'FS_DPH_RUSENIE',
    'FS_DPH_VYMAZANI', 'FS_DPH_NADMERNY_ODPOCET', 'FS_DAN_Z_PRIJMOV',
    'FS_DAN_PRIJMOV_REG', 'REGISTER_UZ', 'CRZ', 'UVO'
  ]
};

fetch("http://localhost:3000/api/reports", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    // simulate logged in user by stealing cookie?
  },
  body: JSON.stringify(data)
}).then(r => r.json()).then(console.log).catch(console.error);
