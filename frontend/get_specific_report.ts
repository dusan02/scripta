import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const req = await prisma.reportRequest.findUnique({
    where: { id: 'cmrcdsicz005o8bw4zl3x6rvo' },
    include: { sources: true }
  })
  if (!req) {
    console.log("No report found with that ID")
    return
  }
  console.log("Report ID:", req.id)
  console.log("Report status:", req.status)
  console.log("Report IČO:", req.ico)
  console.log("Report createdAt:", req.createdAt)
  console.log("Selected Sources length:", req.selectedSources.length)
  console.log("Includes ZRSR?", req.selectedSources.includes("ZRSR"))
  
  const zrsrSource = req.sources.find(s => s.sourceType === 'ZRSR')
  if (zrsrSource) {
    console.log("ZRSR Source Status:", zrsrSource.status)
    console.log("ZRSR Message:", zrsrSource.statusMessage)
    console.log("ZRSR File:", zrsrSource.filePath)
  } else {
    console.log("ZRSR is MISSING from sources relation as well.")
  }
}
main().finally(() => prisma.$disconnect())
