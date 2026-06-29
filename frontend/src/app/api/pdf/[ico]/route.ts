import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(
  request: Request,
  { params }: { params: { ico: string } }
) {
  const ico = params.ico;
  
  // Nájdenie súboru v priečinku worker/assets/{ico}
  // V reálnej produkcii by boli reporty na S3 alebo GCS, pre lokálny beh ukážeme na relatívnu cestu.
  // Z 'frontend' zložky sa posúvame späť do projektu.
  const projectRoot = path.join(process.cwd(), '..');
  const filePath = path.join(projectRoot, 'worker', 'assets', ico, `Verifa_Forensic_Report_${ico}.pdf`);
  
  try {
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Report nenájdený' }, { status: 404 });
    }
    
    const fileBuffer = fs.readFileSync(filePath);
    
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Verifa_Forensic_Report_${ico}.pdf"`,
      },
    });
  } catch (error) {
    console.error('Error serving PDF:', error);
    return NextResponse.json({ error: 'Chyba servera pri sťahovaní PDF' }, { status: 500 });
  }
}
