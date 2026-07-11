import { pollDevices } from '../../utils/poller'

export default defineTask({
  meta: {
    name: 'poll:devices',
    description: 'Poll Tuya devices: readings, energy accounting, outage detection'
  },
  async run() {
    const summary = await pollDevices()
    return { result: summary }
  }
})
