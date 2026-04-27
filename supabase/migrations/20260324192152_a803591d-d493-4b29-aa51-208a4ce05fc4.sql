INSERT INTO storage.buckets (id, name, public) VALUES ('profile-documents', 'profile-documents', true);

CREATE POLICY "Allow all uploads to profile-documents"
ON storage.objects FOR INSERT TO public
WITH CHECK (bucket_id = 'profile-documents');

CREATE POLICY "Allow all reads from profile-documents"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'profile-documents');

CREATE POLICY "Allow all deletes from profile-documents"
ON storage.objects FOR DELETE TO public
USING (bucket_id = 'profile-documents');