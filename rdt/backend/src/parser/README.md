Parser module
----------------
This folder contains the Excel parser used by the RDT module.

Key files:
- excelParser.js : main parser function parseExcelFile(filePath)
- config/mapping.seed.json : seed mapping for dinas normalization (editable)
- config/exclusions.config.json : list of exclusion prefixes

Notes:
- The parser prefers cached formula results (cell.value.result) when present, using exceljs.
- Output is an array of row objects ready to insert into a database.
