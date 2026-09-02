export interface McuChassisCommandMatch {
  tool: string
  preview: string
}

interface ChassisPattern {
  tool: string
  expressions: RegExp[]
}

const CHASSIS_PATTERNS: ChassisPattern[] = [
  {
    tool: 'self.chassis.go_forward',
    expressions: [/^(请)?(前进|向前走|往前走|向前|往前)(一下|一点|吧|呀|啊|哦|啦)?$/],
  },
  {
    tool: 'self.chassis.go_back',
    expressions: [/^(请)?(后退|向后退|往后退|向后|往后)(一下|一点|吧|呀|啊|哦|啦)?$/],
  },
  {
    tool: 'self.chassis.turn_left',
    expressions: [/^(请)?(向左转|往左转|左转)(一下|一点|吧|呀|啊|哦|啦)?$/],
  },
  {
    tool: 'self.chassis.turn_right',
    expressions: [/^(请)?(向右转|往右转|右转)(一下|一点|吧|呀|啊|哦|啦)?$/],
  },
  {
    tool: 'self.chassis.dance',
    expressions: [/^(请)?(跳舞|跳个舞|跳一下舞)(吧|呀|啊|哦|啦)?$/],
  },
  {
    tool: 'self.chassis.switch_light_mode',
    expressions: [/^(请)?(灯光|灯效|开灯|开灯光|切换灯光|切换灯效|打开灯光|打开灯光效果)(模式[1-8])?((1|2|3|4|5|6|7|8)档?)?(吧|呀|啊|哦|啦)?$/],
  },
]

function normalizeTranscript(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s,，。.!！？?、；;：:“”"'‘’（）()\[\]【】<>《》]/g, '')
}

export function matchMcuChassisCommand(transcript: string): McuChassisCommandMatch | null {
  const preview = transcript.trim()
  if (!preview) return null
  const normalized = normalizeTranscript(preview)
  if (!normalized) return null

  for (const candidate of CHASSIS_PATTERNS) {
    if (candidate.expressions.some(expression => expression.test(normalized))) {
      return {
        tool: candidate.tool,
        preview,
      }
    }
  }
  return null
}