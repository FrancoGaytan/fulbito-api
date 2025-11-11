import { Resend } from 'resend'

const provider = process.env.EMAIL_PROVIDER || (process.env.RESEND_API_KEY ? 'resend' : 'console')
const fromEmail = process.env.EMAIL_FROM || 'no-reply@fulbito.local'
const resendApiKey = process.env.RESEND_API_KEY

let resendClient: Resend | null = null
if (provider === 'resend' && resendApiKey) {
  resendClient = new Resend(resendApiKey)
}

export interface SendResetCodeOptions {
  email: string
  code: string
  ttlMinutes: number
}

export async function sendPasswordResetCode(opts: SendResetCodeOptions): Promise<void> {
  const { email, code, ttlMinutes } = opts

  if (provider === 'console' || !resendClient) {
    console.log(`[EMAIL:RESET][DEV] to=${email} code=${code} ttl=${ttlMinutes}m`)
    return
  }

  try {
    await resendClient.emails.send({
      from: fromEmail,
      to: email,
      subject: 'Tu código para resetear contraseña',
      text: `Usá este código para resetear tu contraseña: ${code}\nVence en ${ttlMinutes} minutos. Si vos no lo pediste ignorá este correo.`,
    })
  } catch (err) {
    console.error('[EMAIL:RESET][ERROR]', (err as Error).message)
    // No propagar error para no filtrar existencia del email
  }
}
