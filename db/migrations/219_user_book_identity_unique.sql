-- Segnalibro
-- Migration 219: keep a user's ISBNs and catalog editions unique under concurrent adds.

begin;

create unique index user_books_user_edition_uidx
	on public.user_books (user_id, edition_id)
	where edition_id is not null;

create unique index user_books_user_isbn_10_uidx
	on public.user_books (user_id, isbn_10)
	where isbn_10 is not null;

create unique index user_books_user_isbn_13_uidx
	on public.user_books (user_id, isbn_13)
	where isbn_13 is not null;

commit;
