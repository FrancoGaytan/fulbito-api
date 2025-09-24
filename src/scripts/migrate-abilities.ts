import mongoose from 'mongoose'
import { Player } from '../models/player.model'
import { isAbilityKey } from '../constants/abilities'

const MONGODB_URI = process.env.MONGO_URI!

async function main() {
  await mongoose.connect(MONGODB_URI)

  const cursor = Player.find().cursor()
  let updated = 0

  for await (const doc of cursor) {
    const val = doc.get('abilities')
    if (Array.isArray(val)) {
      const map: Record<string, number> = {}
      for (const k of val) if (isAbilityKey(k)) map[k] = 7
      doc.set('abilities', Object.keys(map).length ? map : undefined)
      await doc.save()
      updated++
    }
  }

  console.log(`Migrados ${updated} jugadores`)
  await mongoose.disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
