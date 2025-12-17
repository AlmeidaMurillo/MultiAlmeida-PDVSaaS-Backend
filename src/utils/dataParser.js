export function parsePlano(plano) {
  if (!plano) return null;
  
  return {
    ...plano,
    preco: parseFloat(plano.preco),
    beneficios: typeof plano.beneficios === 'string' 
      ? JSON.parse(plano.beneficios) 
      : plano.beneficios,
  };
}

export function parsePlanos(planos) {
  if (!Array.isArray(planos)) return [];
  return planos.map(parsePlano);
}

export function formatPreco(preco) {
  if (typeof preco === 'number') return preco;
  if (typeof preco === 'string') {
    return parseFloat(preco.replace(',', '.'));
  }
  return 0;
}

export function validateEmail(email) {
  if (!email || typeof email !== 'string') return null;
  
  const sanitized = email.toLowerCase().trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  return emailRegex.test(sanitized) ? sanitized : null;
}

export function validateNome(nome) {
  if (!nome || typeof nome !== 'string') return null;
  
  const sanitized = nome.trim();
  
  return sanitized.length >= 2 ? sanitized : null;
}
