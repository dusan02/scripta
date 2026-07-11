import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const req = await prisma.reportRequest.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { sources: true }
  })
  if (!req) {
    console.log("No reports found")
    return
  }
  console.log("Report IČO:", req.ico)
  console.log("Selected Sources length:", req.selectedSources.length)
  
  const zrsrSource = req.sources.find(s => s.sourceType === 'ZRSR')
  console.log("ZRSR Source DB Status:", zrsrSource?.status)
  console.log("ZRSR Source Message:", zrsrSource?.statusMessage)
  console.log("ZRSR Findings:", zrsrSource?.findings)
  console.log("ZRSR FilePath:", zrsrSource?.filePath)
  console.log("ZRSR PageCount:", zrsrSource?.pageCount)
}
main().finally(() => prisma.$disconnect())
