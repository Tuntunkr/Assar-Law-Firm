import { ButtonLink, Container } from '@assar/ui';

export default function NotFound() {
  return (
    <Container className="py-32 text-center">
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <ButtonLink href="/" className="mt-6">
        Back to home
      </ButtonLink>
    </Container>
  );
}
